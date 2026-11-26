import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceData } from '../src/shared/types'
import {
  automaticBackups,
  BACKUP_KEEP,
  backupFiles,
  backupFolder,
  writeBackup,
} from '../src/node/backups'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'

/** A real data file in a folder of its own, like the one the server runs on. */
function workspace() {
  const folder = mkdtempSync(join(tmpdir(), 'studydeck-backups-'))
  const path = join(folder, 'studydeck.db')
  const app = createApp(openDatabase(path), {})
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
