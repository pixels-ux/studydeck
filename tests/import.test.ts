import { expect, test } from 'bun:test'
import type { WorkspaceData } from '../src/shared/types'
import { openDatabase } from '../src/node/sqlite'
import { ensureSchema, migrate, scopedOwner } from '../src/server/db.ts'
import { createApp } from '../src/server/app'
import type { SqlDatabase } from '../src/server/sql'

const DATE = '2026-11-20'

function harness() {
  const db = openDatabase(':memory:')
  const app = createApp(db)
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    notebook?: string,
  ) =>
    app.request(`http://localhost${path}`, {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        ...(notebook ? { 'x-notebook': notebook } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const data = async (notebook?: string) =>
    (await (await call('/api/data', 'GET', undefined, notebook)).json()) as WorkspaceData
  return { db, call, data }
}

type ExportPart = {
  notebook: { id: string; name: string }
  subjects: { title?: string; name?: string }[]
  entries: unknown[]
  tasks: unknown[]
  notes: { body: string }[]
  days: { date: string; school: { topic: string }[]; brief: string }[]
  syllabus: { chapter: string }[]
  sources: { title: string }[]
  library: { role: string; citations: { sourceTitle: string }[] }[]
}

type ExportFile = {
  version: number
  profile: { classLevel: number } | null
  notebooks: ExportPart[]
}

/** One of everything a backup can hold, written straight to the table. */
async function seed(db: SqlDatabase, owner: string) {
  await db
    .prepare(
      `INSERT INTO profiles (owner_sub, class_level, school_days, school_start, school_end, period_length, study_hours, setup_at)
       VALUES ('local', 10, '0,1,2,3,4', 480, 900, 45, 3, 111)`,
    )
    .run()
  await db
    .prepare(
      `INSERT INTO subjects (id, owner_sub, name, color, teacher, exam_date, created_at)
       VALUES ('sub-1', ?, 'Mathematics', '#3f6b52', 'Ms Rao', '', 112)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO entries (id, owner_sub, subject_id, title, kind, day, start_min, end_min, room, plan, date)
       VALUES ('ent-1', ?, 'sub-1', 'Mathematics', 'class', 0, 480, 525, 'Room 4', 'regular', '')`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO tasks (id, owner_sub, subject_id, title, due_date, priority, done, details, created_at)
       VALUES ('task-1', ?, 'sub-1', 'Exercise 4.2', '2026-11-25', 'normal', 0, '', 113)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at)
       VALUES ('note-1', ?, 'sub-1', 'Quadratics', 'x^2 + bx + c', 114, 114)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO sources (id, owner_sub, subject_id, title, origin, body, created_at, updated_at)
       VALUES ('source-1', ?, 'sub-1', 'Chapter 3', 'Pasted', 'A quadratic equation looks like ax^2 + bx + c = 0.', 115, 115)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO library_messages (id, owner_sub, subject_id, role, body, citations, created_at)
       VALUES ('msg-1', ?, 'sub-1', 'student', 'What is a quadratic?', '[]', 116)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO library_messages (id, owner_sub, subject_id, role, body, citations, created_at)
       VALUES ('msg-2', ?, 'sub-1', 'assistant', 'An equation of degree two [1].',
        '[{"index":1,"sourceId":"source-1","sourceTitle":"Chapter 3"}]', 117)`,
    )
    .bind(owner)
    .run()
  await db
    .prepare(
      `INSERT INTO day_logs (owner_sub, date, school, coaching, homework, free_from, free_until, brief, updated_at)
       VALUES (?, ?, '[{"subjectId":"sub-1","title":"Mathematics","topic":"Quadratic equations"}]',
        'null', '[]', 1080, 1290, 'Start with Exercise 4.2.', 118)`,
    )
    .bind(owner, DATE)
    .run()
  await db
    .prepare(
      `INSERT INTO syllabus_progress (owner_sub, subject_id, chapter, done_at)
       VALUES (?, 'sub-1', 'Quadratic equations', 119)`,
    )
    .bind(owner)
    .run()
}

async function backupOf(db: SqlDatabase): Promise<ExportFile> {
  const app = createApp(db)
  const response = await app.request('http://localhost/api/export')
  return (await response.json()) as ExportFile
}

/** A version 1 file: one notebook's data at the top level. */
function asVersionOne(file: ExportFile): Record<string, unknown> {
  const part = file.notebooks[0]!
  return {
    app: 'Studydeck',
    version: 1,
    profile: file.profile,
    subjects: part.subjects,
    entries: part.entries,
    tasks: part.tasks,
    notes: part.notes,
    days: part.days,
    syllabus: part.syllabus,
    sources: part.sources,
    library: part.library,
  }
}

test('a backup restores every notebook it holds', async () => {
  const source = harness()
  const sourceData = await source.data()
  const owner = scopedOwner(sourceData.notebookId)
  await seed(source.db, owner)
  const file = await backupOf(source.db)
  expect(file.version).toBe(2)
  expect(file.notebooks).toHaveLength(1)

  const target = harness()
  const response = await target.call('/api/import', 'POST', file)
  expect(response.status).toBe(200)
  const result = (await response.json()) as {
    added: Record<string, number>
    skipped: Record<string, number>
  }
  expect(result.added.subjects).toBe(1)
  expect(result.added.entries).toBe(1)
  expect(result.added.tasks).toBe(1)
  expect(result.added.notes).toBe(1)
  expect(result.added.sources).toBe(1)
  expect(result.added.library).toBe(2)
  expect(result.added.days).toBe(1)
  expect(result.added.syllabus).toBe(1)
  expect(result.added.profile).toBe(1)

  const importedId = file.notebooks[0]!.notebook.id
  const data = await target.data(importedId)
  expect(data.notebooks.map((notebook) => notebook.name)).toEqual(['My notebook'])
  expect(data.profile?.classLevel).toBe(10)
  expect(data.subjects.map((subject) => subject.name)).toEqual(['Mathematics'])
  expect(data.entries).toHaveLength(1)
  expect(data.entries[0]?.id).toBe('ent-1')
  expect(data.entries[0]?.subjectId).toBe('sub-1')
  expect(data.tasks[0]?.title).toBe('Exercise 4.2')
  expect(data.notes[0]?.body).toBe('x^2 + bx + c')
  expect(data.sources[0]?.title).toBe('Chapter 3')
  expect(data.library.map((message) => message.role)).toEqual([
    'student',
    'assistant',
  ])
  expect(data.library[1]?.citations[0]?.sourceTitle).toBe('Chapter 3')

  const saved = await backupOf(target.db)
  expect(saved.notebooks[0]?.days[0]?.date).toBe(DATE)
  expect(saved.notebooks[0]?.days[0]?.school[0]?.topic).toBe('Quadratic equations')
  expect(saved.notebooks[0]?.days[0]?.brief).toContain('Exercise 4.2')
  expect(saved.notebooks[0]?.syllabus[0]?.chapter).toBe('Quadratic equations')
})

test('importing the same file twice adds nothing the second time', async () => {
  const source = harness()
  const sourceData = await source.data()
  await seed(source.db, scopedOwner(sourceData.notebookId))
  const file = await backupOf(source.db)

  const target = harness()
  expect((await target.call('/api/import', 'POST', file)).status).toBe(200)
  const again = await target.call('/api/import', 'POST', file)
  expect(again.status).toBe(200)
  const result = (await again.json()) as {
    added: Record<string, number>
    skipped: Record<string, number>
  }
  expect(Object.values(result.added).every((count) => count === 0)).toBe(true)
  expect(result.skipped.entries).toBe(1)
  expect(result.skipped.days).toBe(1)
  expect(result.skipped.profile).toBe(1)

  const data = await target.data(file.notebooks[0]!.notebook.id)
  expect(data.subjects).toHaveLength(1)
  expect(data.entries).toHaveLength(1)
  expect(data.notebooks).toHaveLength(1)
})

test('a subject with the same name is reused instead of duplicated', async () => {
  const source = harness()
  const sourceData = await source.data()
  await seed(source.db, scopedOwner(sourceData.notebookId))
  const file = await backupOf(source.db)

  const target = harness()
  const created = await target.call('/api/subjects', 'POST', {
    name: 'Mathematics',
    color: '#123456',
  })
  expect(created.status).toBe(201)
  const { subject } = (await created.json()) as { subject: { id: string } }

  const response = await target.call('/api/import', 'POST', asVersionOne(file))
  expect(response.status).toBe(200)
  const data = await target.data()
  expect(data.subjects).toHaveLength(1)
  expect(data.subjects[0]?.id).toBe(subject.id)
  expect(data.entries[0]?.subjectId).toBe(subject.id)
  expect(data.tasks[0]?.subjectId).toBe(subject.id)
})

test('a checked-in day and a saved class setup win over the file', async () => {
  const source = harness()
  const sourceData = await source.data()
  await seed(source.db, scopedOwner(sourceData.notebookId))
  const file = await backupOf(source.db)

  const target = harness()
  await target.call('/api/data')
  await target.db
    .prepare(
      `INSERT INTO profiles (owner_sub, class_level, school_days, school_start, school_end, period_length, study_hours, setup_at)
       VALUES ('local', 9, '0,1,2', 500, 800, 40, 2, 900)`,
    )
    .run()
  const targetData = await target.data()
  await target.db
    .prepare(
      `INSERT INTO day_logs (owner_sub, date, school, coaching, homework, free_from, free_until, brief, updated_at)
       VALUES (?, ?, '[{"subjectId":null,"title":"Science","topic":"Own topic"}]', 'null', '[]', 1000, 1200, '', 901)`,
    )
    .bind(scopedOwner(targetData.notebookId), DATE)
    .run()

  const response = await target.call('/api/import', 'POST', asVersionOne(file))
  expect(response.status).toBe(200)
  const result = (await response.json()) as {
    added: Record<string, number>
    skipped: Record<string, number>
  }
  expect(result.skipped.profile).toBe(1)
  expect(result.skipped.days).toBe(1)

  const data = await target.data()
  expect(data.profile?.classLevel).toBe(9)
  const saved = await backupOf(target.db)
  const day = saved.notebooks.find((part) => part.notebook.id === data.notebookId)!
    .days[0]
  expect(day?.school[0]?.topic).toBe('Own topic')
})

test('notebooks stay apart when one is switched to', async () => {
  const { call, data } = harness()
  const first = await data()
  const created = await call('/api/notebooks', 'POST', { name: 'NEET prep' })
  expect(created.status).toBe(200)
  const { notebook } = (await created.json()) as {
    notebook: { id: string; name: string }
  }

  await call('/api/tasks', 'POST', {
    title: 'Only in NEET',
    dueDate: '2026-11-30',
    priority: 'normal',
    details: '',
    done: false,
  }, notebook.id)
  expect((await data(notebook.id)).tasks.map((task) => task.title)).toEqual([
    'Only in NEET',
  ])
  expect((await data(first.notebookId)).tasks).toHaveLength(0)

  // Both books travel together.
  const exported = (await (
    await call('/api/export')
  ).json()) as ExportFile
  expect(exported.notebooks.map((part) => part.notebook.name)).toEqual([
    'My notebook',
    'NEET prep',
  ])
  expect(exported.notebooks[1]?.tasks[0]).toMatchObject({ title: 'Only in NEET' })
})

test('data from before notebooks moves into the first notebook', async () => {
  const db = openDatabase(':memory:')
  await ensureSchema(db)
  // Put the file back the way an older Studydeck left it: rows owned by
  // "local", no notebook at all.
  await db.prepare('DELETE FROM notebooks').run()
  await db
    .prepare(
      `INSERT INTO subjects (id, owner_sub, name, color, teacher, exam_date, created_at)
       VALUES ('old-1', 'local', 'History', '#223344', '', '', 100)`,
    )
    .run()
  await db
    .prepare(
      `INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at)
       VALUES ('old-note', 'local', 'old-1', 'Revolution', '1789', 101, 101)`,
    )
    .run()

  await migrate(db)
  const data = (await (
    await createApp(db).request('http://localhost/api/data')
  ).json()) as WorkspaceData
  expect(data.notebooks.map((notebook) => notebook.name)).toEqual(['My notebook'])
  expect(data.notebookId).toBe(data.notebooks[0]!.id)
  expect(data.subjects.map((subject) => subject.name)).toEqual(['History'])
  expect(data.notes[0]?.title).toBe('Revolution')

  // A second run changes nothing.
  await migrate(db)
  expect((await (await createApp(db).request('http://localhost/api/data')).json() as WorkspaceData).notebooks).toHaveLength(1)
})

test('a file that is not a whole backup is refused', async () => {
  const target = harness()
  for (const body of [
    { app: 'Somewhere else', version: 1 },
    { app: 'Studydeck', version: 5 },
    { app: 'Studydeck', version: 2, notebooks: [] },
    { app: 'Studydeck', version: 2, notebooks: [{ notebook: { id: 'x' } }] },
    { app: 'Studydeck', version: 1, entries: 'everything' },
    {
      app: 'Studydeck',
      version: 1,
      days: [{ date: DATE, school: [], homework: [], freeFrom: 1200, freeUntil: 1100 }],
    },
    {
      app: 'Studydeck',
      version: 1,
      subjects: [{ id: 'not a valid id', name: 'Mathematics' }],
    },
    {
      app: 'Studydeck',
      version: 1,
      profile: { classLevel: 2, schoolDays: [0], schoolStart: 0, schoolEnd: 10, periodLength: 45, studyHours: 3 },
    },
  ]) {
    expect((await target.call('/api/import', 'POST', body)).status).toBe(400)
  }
  expect((await target.call('/api/import', 'POST', [])).status).toBe(400)
  expect(await target.data()).toMatchObject({ subjects: [], entries: [] })
})

test('a backup bigger than the ordinary request limit is accepted', async () => {
  const target = harness()
  const sources = Array.from({ length: 250 }, (_, index) => ({
    id: `big-${index}`,
    title: `Material ${index}`,
    origin: 'Pasted',
    body: `${index} ${'x'.repeat(1_500)}`,
    createdAt: index,
    updatedAt: index,
  }))
  const file = { app: 'Studydeck', version: 1, sources }
  expect(JSON.stringify(file).length).toBeGreaterThan(300 * 1024)

  const response = await target.call('/api/import', 'POST', file)
  expect(response.status).toBe(200)
  const result = (await response.json()) as { added: Record<string, number> }
  expect(result.added.sources).toBe(250)
  expect((await target.data()).sources).toHaveLength(250)
})
