import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceData } from '../src/shared/types'
import {
  automaticBackups,
  BACKUP_KEEP,
  backupFiles,
  backupFolder,
  BackupFailed,
  fileBackups,
  listBackups,
  writeBackup,
} from '../src/node/backups'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'

/** A real data file in a folder of its own, like the one the server runs on. */
function workspace(automatic = false) {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')
  const app = createApp(
    openDatabase(path),
    {},
    automatic ? { backups: fileBackups(path) } : {},
  )
  const call = (route: string, method = 'GET', body?: unknown) =>
    app.request(`http://localhost${route}`, {
      method,
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const read = async () => {
    const response = await call('/api/export')
    return response.ok ? await response.text() : null
  }
  return { folder, path, app, call, read }
}

test('a copy is the file Import a backup already reads', async () => {
  const { path, call, read } = workspace()

  // A fresh install has nothing to keep, so it writes no empty copies.
  expect(await writeBackup(path, read)).toBeNull()
  expect(backupFiles(path)).toHaveLength(0)

  await call('/api/notes', 'POST', {
    subjectId: null,
    title: 'Light',
    body: 'Light is both a wave and a particle.',
  })

  const file = await writeBackup(path, read)
  expect(file).not.toBeNull()
  const written = readFileSync(file!, 'utf8')
  expect(JSON.parse(written).notebooks[0].notes).toHaveLength(1)

  // The very same file loads back into an empty workspace.
  const restored = createApp(openDatabase(':memory:'), {})
  const imported = await restored.request('http://localhost/api/import', {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: written,
  })
  expect(imported.status).toBe(200)
  const data = (await (
    await restored.request('http://localhost/api/data')
  ).json()) as WorkspaceData
  expect(data.notes.map((note) => note.title)).toEqual(['Light'])
})

test('only the newest copies stay', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')

  for (let index = 0; index < BACKUP_KEEP + 3; index += 1)
    await writeBackup(path, async () =>
      JSON.stringify({
        app: 'Studydeck',
        notebooks: [{ notes: [{ title: `copy-${index}`, body: 'x' }] }],
      }),
    )

  const files = backupFiles(path)
  expect(files).toHaveLength(BACKUP_KEEP)
  const titles = files.map(
    (name) =>
      JSON.parse(readFileSync(join(backupFolder(path), name), 'utf8'))
        .notebooks[0].notes[0].title,
  )
  // The three oldest went; the newest copy is still the newest.
  expect(titles[0]).toBe('copy-3')
  expect(titles.at(-1)).toBe(`copy-${BACKUP_KEEP + 2}`)
})

test('a copy runs before a delete, and now and then while editing', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')
  let clock = Date.now()
  const backups = automaticBackups(
    path,
    async () =>
      JSON.stringify({
        app: 'Studydeck',
        notebooks: [{ notes: [{ title: 'Light', body: 'x' }] }],
      }),
    { now: () => clock },
  )

  await backups.startup()
  expect(backupFiles(path)).toHaveLength(1)

  // A restart within the hour does not churn the folder.
  await backups.startup()
  expect(backupFiles(path)).toHaveLength(1)

  // Editing alone rolls at most every half hour.
  clock += 60_000
  backups.after('POST', '/api/notes', true)
  await backups.flush()
  expect(backupFiles(path)).toHaveLength(1)

  clock += 31 * 60_000
  backups.after('POST', '/api/notes', true)
  await backups.flush()
  expect(backupFiles(path)).toHaveLength(2)

  // Emptying a notebook always earns a copy of what it is about to lose.
  await backups.before('DELETE', '/api/workspace')
  expect(backupFiles(path)).toHaveLength(3)

  // Reading, failing, or typing something that is not destructive adds nothing.
  await backups.before('GET', '/api/workspace')
  await backups.before('POST', '/api/notes')
  backups.after('POST', '/api/notes', false)
  await backups.flush()
  expect(backupFiles(path)).toHaveLength(3)
})

test('a wipe is refused when its copy cannot be written', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')
  // A file where the backups folder should be: every copy of it fails.
  writeFileSync(join(folder, 'backups'), 'not a folder')
  const body = JSON.stringify({
    app: 'Studydeck',
    notebooks: [{ notes: [{ title: 'Light', body: 'x' }] }],
  })
  const backups = automaticBackups(path, async () => body)
  // A copy that fails is reported as a refusal, not as console noise.
  const quiet = spyOn(console, 'error').mockImplementation(() => undefined)

  await expect(backups.before('DELETE', '/api/workspace')).rejects.toThrow(
    BackupFailed,
  )
  await expect(
    backups.before('DELETE', '/api/notebooks/abc'),
  ).rejects.toThrow(BackupFailed)
  // An import is how a bad edit gets put right, so it never waits on a copy.
  await backups.before('POST', '/api/import')
  await backups.before('POST', '/api/setup')

  // A workspace with nothing in it loses nothing: the delete may go ahead.
  const emptyFolder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const empty = join(emptyFolder, 'studydeck.db')
  writeFileSync(join(emptyFolder, 'backups'), 'not a folder')
  const nothing = automaticBackups(empty, async () =>
    JSON.stringify({ app: 'Studydeck', notebooks: [{ notes: [] }] }),
  )
  await nothing.before('DELETE', '/api/workspace')
  quiet.mockRestore()
})

test('the copy being put back is never pruned away first', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')
  let body = ''
  for (let index = 0; index < BACKUP_KEEP; index += 1) {
    body = JSON.stringify({
      notebooks: [{ notes: [{ title: `copy-${index}`, body: 'x' }] }],
    })
    await writeBackup(path, async () => body)
  }

  const oldest = backupFiles(path)[0]!
  const backups = automaticBackups(path, async () => body)
  await backups.before(
    'POST',
    `/api/backups/${encodeURIComponent(oldest)}/restore`,
  )
  expect(backupFiles(path)).toContain(oldest)
  expect(backupFiles(path)).toHaveLength(BACKUP_KEEP + 1)
})

test('Settings lists each copy with what it holds', async () => {
  const { path, call, read } = workspace()
  await call('/api/notes', 'POST', {
    subjectId: null,
    title: 'Light',
    body: 'Light is both a wave and a particle.',
  })
  await call('/api/tasks', 'POST', {
    subjectId: null,
    title: 'Homework',
    dueDate: '',
    priority: 'normal',
    details: '',
    done: false,
  })
  await writeBackup(path, read)

  const copies = listBackups(path)
  expect(copies).toHaveLength(1)
  expect(copies[0]!.summary).toBe('1 notebook · 1 note · 1 task')
  expect(copies[0]!.bytes).toBeGreaterThan(0)
  expect(copies[0]!.writtenAt).toBeGreaterThan(0)

  // The app may read a copy it just listed, and nothing outside the folder.
  expect(fileBackups(path).read(copies[0]!.name)).toContain('Light')
  expect(fileBackups(path).read('../studydeck.db')).toBeNull()
  expect(fileBackups(path).read('studydeck-missing-001.json')).toBeNull()
})

test('a copy puts the whole workspace back as it was', async () => {
  const { path, call, read } = workspace(true)
  const created = await call('/api/notes', 'POST', {
    subjectId: null,
    title: 'Light',
    body: 'Light is both a wave and a particle.',
  })
  const note = ((await created.json()) as { note: { id: string } }).note
  await call('/api/tasks', 'POST', {
    subjectId: null,
    title: 'Homework',
    dueDate: '',
    priority: 'normal',
    details: '',
    done: false,
  })
  expect(await writeBackup(path, read)).not.toBeNull()

  // A bad afternoon: the note is rewritten and another task is added.
  await call(`/api/notes/${note.id}`, 'PATCH', {
    subjectId: null,
    title: 'Light',
    body: 'Rewritten badly.',
  })
  await call('/api/tasks', 'POST', {
    subjectId: null,
    title: 'Another task',
    dueDate: '',
    priority: 'low',
    details: '',
    done: false,
  })

  const listed = (await (await call('/api/backups')).json()) as {
    backups: { name: string }[]
  }
  expect(listed.backups).toHaveLength(1)
  const restored = await call(
    `/api/backups/${encodeURIComponent(listed.backups[0]!.name)}/restore`,
    'POST',
  )
  expect(restored.status).toBe(200)
  const answer = (await restored.json()) as { workspace: WorkspaceData }
  expect(answer.workspace.notes.map((entry) => entry.body)).toEqual([
    'Light is both a wave and a particle.',
  ])
  expect(answer.workspace.tasks).toHaveLength(1)

  // Read again, so this is what the data file holds and not just the reply.
  const data = (await (await call('/api/data')).json()) as WorkspaceData
  expect(data.notes[0]!.body).toBe('Light is both a wave and a particle.')
  expect(data.tasks.map((task) => task.title)).toEqual(['Homework'])

  // A name that is not in the folder is refused, not guessed at.
  expect((await call('/api/backups/nope/restore', 'POST')).status).toBe(404)
})
