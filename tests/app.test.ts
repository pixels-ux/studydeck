import { expect, test } from 'bun:test'
import type { Note, Subject, Task, WorkspaceData } from '../src/shared/types'
import { buildSetupPayload } from '../src/client/setupPayload'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import type { Env } from '../src/server/env'

// The real storage engine, in memory: one workspace, no cloud services.
const env: Env = {}
const app = createApp(openDatabase(':memory:'), env)

const call = (
  path: string,
  method = 'GET',
  body?: unknown,
  origin = 'http://localhost',
) =>
  app.request(`http://localhost${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const data = async () =>
  (await (await call('/api/data')).json()) as WorkspaceData

const setupBody = {
  classLevel: 10,
  schoolDays: [0, 1, 2, 3, 4],
  schoolStart: 480,
  schoolEnd: 870,
  periodLength: 45,
  studyHours: 3,
  subjects: [
    {
      key: 'chem',
      name: 'Chemistry',
      color: '#7a5a3f',
      teacher: '',
      examDate: '2026-12-05',
    },
    {
      key: 'maths',
      name: 'Mathematics',
      color: '#3f6b52',
      teacher: '',
      examDate: '2026-12-09',
    },
  ],
  regular: [
    {
      subjectId: 'chem',
      title: 'Chemistry',
      kind: 'class',
      plan: 'regular',
      day: 0,
      startMin: 480,
      endMin: 525,
      room: 'Room 4',
      date: '',
    },
    {
      subjectId: 'maths',
      title: 'Mathematics',
      kind: 'class',
      plan: 'regular',
      day: 0,
      startMin: 530,
      endMin: 575,
      room: '',
      date: '',
    },
  ],
  revision: [
    {
      subjectId: 'chem',
      title: 'Chemistry revision',
      kind: 'study',
      plan: 'intensive',
      date: '2026-12-01',
      day: 1,
      startMin: 960,
      endMin: 1010,
      room: '',
    },
  ],
}

test('health is open, unknown endpoints are not, and assets are not the API', async () => {
  expect((await call('/api/health')).status).toBe(200)
  expect((await call('/api/nope')).status).toBe(404)
  expect((await call('/api/data')).headers.get('Cache-Control')).toBe(
    'private, no-store',
  )
  const page = await call('/')
  expect(page.status).toBe(404)
  expect(await page.text()).toBe('Not found')
})

test('a new workspace starts empty and stores notes, tasks and subjects', async () => {
  const empty = await data()
  expect(empty.subjects).toHaveLength(0)
  expect(empty.entries).toHaveLength(0)
  expect(empty.profile).toBeNull()
  expect(empty.ai.enabled).toBe(false)

  const created = await call('/api/notes', 'POST', {
    title: '  Trig identities ',
    body: 'sin²x + cos²x = 1',
  })
  expect(created.status).toBe(201)
  const { note } = (await created.json()) as { note: Note }
  expect(note.title).toBe('Trig identities')

  const updated = await call(`/api/notes/${note.id}`, 'PATCH', {
    title: 'Trig identities',
    body: 'sin²x + cos²x = 1, and tan x = sin x / cos x',
  })
  expect(updated.status).toBe(200)
  expect((await updated.json()) as { note: Note }).toMatchObject({
    note: { body: 'sin²x + cos²x = 1, and tan x = sin x / cos x' },
  })

  const task = await call('/api/tasks', 'POST', {
    title: 'Finish problem set',
    dueDate: '2026-12-01',
    priority: 'high',
    done: false,
  })
  expect(task.status).toBe(201)
  const { task: saved } = (await task.json()) as { task: Task }
  expect((await call(`/api/tasks/${saved.id}`, 'DELETE')).status).toBe(200)
  expect((await call(`/api/tasks/${saved.id}`, 'DELETE')).status).toBe(404)

  const subject = await call('/api/subjects', 'POST', {
    name: 'Chemistry',
    color: '#40607a',
  })
  expect(subject.status).toBe(201)
  const { subject: chem } = (await subject.json()) as { subject: Subject }
  expect(chem.name).toBe('Chemistry')
})

test('class setup stores the profile, resolves subject keys and keeps notes', async () => {
  const response = await call('/api/setup', 'POST', setupBody)
  expect(response.status).toBe(200)
  const after = (await response.json()) as WorkspaceData

  expect(after.profile).toMatchObject({
    classLevel: 10,
    schoolDays: [0, 1, 2, 3, 4],
    schoolStart: 480,
    schoolEnd: 870,
    periodLength: 45,
    studyHours: 3,
  })
  expect(after.subjects.map((subject) => subject.name).sort()).toEqual([
    'Chemistry',
    'Mathematics',
  ])
  expect(after.notes).toHaveLength(1)
  expect(after.entries).toHaveLength(3)

  const ids = after.subjects.map((subject) => subject.id)
  for (const entry of after.entries) {
    expect(entry.subjectId === null || ids.includes(entry.subjectId)).toBe(true)
  }
  const chemistry = after.subjects.find((subject) => subject.name === 'Chemistry')!
  expect(chemistry.examDate).toBe('2026-12-05')
  expect(
    after.entries.filter((entry) => entry.subjectId === chemistry.id).length,
  ).toBe(2)

  // Re-running keeps the note and reuses the subject rows by name.
  const again = await call('/api/setup', 'POST', {
    ...setupBody,
    subjects: setupBody.subjects.map((subject) => ({
      ...subject,
      examDate: '2026-12-11',
    })),
  })
  expect(again.status).toBe(200)
  const reRun = (await again.json()) as WorkspaceData
  expect(reRun.subjects.map((subject) => subject.id).sort()).toEqual([...ids].sort())
  expect(reRun.notes).toHaveLength(1)
  expect(reRun.subjects[0]!.examDate).toBe('2026-12-11')

  for (const broken of [
    { ...setupBody, subjects: [] },
    { ...setupBody, schoolDays: [] },
    { ...setupBody, schoolEnd: 400 },
    { ...setupBody, classLevel: 14 },
    {
      ...setupBody,
      regular: [{ ...setupBody.regular[0]!, plan: 'intensive' }],
    },
  ]) {
    expect((await call('/api/setup', 'POST', broken)).status).toBe(400)
  }
})

test('syllabus progress ticks, clears and ignores unknown subjects', async () => {
  const workspace = await data()
  const subject = workspace.subjects[0]!
  expect(subject).toBeDefined()

  const tick = await call('/api/syllabus', 'POST', {
    subjectId: subject.id,
    chapter: 'Light – Reflection and Refraction',
    done: true,
  })
  expect(tick.status).toBe(200)
  expect((await data()).syllabus).toEqual([
    { subjectId: subject.id, chapter: 'Light – Reflection and Refraction' },
  ])

  // Ticking twice keeps one row instead of piling up duplicates.
  expect(
    (
      await call('/api/syllabus', 'POST', {
        subjectId: subject.id,
        chapter: 'Light – Reflection and Refraction',
        done: true,
      })
    ).status,
  ).toBe(200)
  expect((await data()).syllabus).toHaveLength(1)

  expect(
    (
      await call('/api/syllabus', 'POST', {
        subjectId: 'not-a-real-id',
        chapter: 'Light',
        done: true,
      })
    ).status,
  ).toBe(404)

  // Clearing a chapter removes the tick.
  await call('/api/syllabus', 'POST', {
    subjectId: subject.id,
    chapter: 'Light – Reflection and Refraction',
    done: false,
  })
  expect((await data()).syllabus).toHaveLength(0)

  for (const body of [
    { subjectId: subject.id, chapter: '   ', done: true },
    { chapter: 'Light', done: true },
  ]) {
    expect((await call('/api/syllabus', 'POST', body)).status).toBe(400)
  }
})

test('timetable, revision plan and validation rules hold', async () => {
  const week = await call('/api/entries', 'POST', {
    title: 'Chemistry',
    kind: 'class',
    plan: 'regular',
    day: 2,
    startMin: 11 * 60,
    endMin: 12 * 60,
    room: 'Lab 1',
    subjectId: null,
  })
  expect(week.status).toBe(201)

  const plan = await call('/api/entries/plan', 'POST', {
    entries: [
      {
        title: 'Chemistry revision',
        kind: 'study',
        plan: 'intensive',
        date: '2026-12-01',
        day: 1,
        startMin: 17 * 60,
        endMin: 17 * 60 + 50,
        room: '',
        subjectId: null,
      },
    ],
  })
  expect(plan.status).toBe(200)
  const built = (await plan.json()) as { entries: { date: string }[] }
  expect(built.entries).toHaveLength(1)
  expect(built.entries[0]!.date).toBe('2026-12-01')

  const cleared = await call('/api/entries/plan', 'POST', { entries: [] })
  expect(((await cleared.json()) as { entries: unknown[] }).entries).toHaveLength(0)

  expect(
    (
      await call('/api/entries', 'POST', {
        title: 'Backwards',
        kind: 'class',
        plan: 'regular',
        day: 0,
        startMin: 600,
        endMin: 540,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call('/api/entries', 'POST', {
        title: 'No date',
        kind: 'study',
        plan: 'intensive',
        startMin: 600,
        endMin: 660,
      })
    ).status,
  ).toBe(400)

  for (const [path, body] of [
    ['/api/subjects', { name: '   ' }],
    ['/api/tasks', { title: '', priority: 'normal', done: false }],
    ['/api/notes', { title: 'Empty', body: '   ' }],
  ] as const) {
    expect((await call(path, 'POST', body)).status).toBe(400)
  }
  expect(
    (await call('/api/notes', 'POST', { body: 'x'.repeat(9000) })).status,
  ).toBe(400)
  expect(
    (await call('/api/notes', 'POST', { body: 'x'.repeat(300_000) })).status,
  ).toBe(413)
})

test('writes from another origin are refused and the AI desk reports its missing key', async () => {
  expect(
    (
      await call(
        '/api/tasks',
        'POST',
        { title: 'Nope', priority: 'low', done: false },
        'https://foreign.example',
      )
    ).status,
  ).toBe(403)
  // A request with no Origin at all comes from curl or a local script, not a
  // browser, so it is treated as this origin and allowed.
  const local = await app.request('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'From a script',
      priority: 'low',
      done: false,
    }),
  })
  expect(local.status).toBe(201)

  const ask = await call('/api/ai/ask', 'POST', {
    question: 'What is photosynthesis?',
  })
  expect(ask.status).toBe(503)
  expect(((await ask.json()) as { error: string }).error).toContain(
    'Paste an API key',
  )
  expect((await call('/api/ai/summarize', 'POST', {})).status).toBe(503)
})

test('the workspace exports, becomes a calendar file and can be reset', async () => {
  const exported = await call('/api/export')
  expect(exported.status).toBe(200)
  expect(exported.headers.get('content-disposition')).toContain('studydeck-')
  const file = (await exported.json()) as {
    app: string
    version: number
    notebooks: { subjects: { name: string }[]; entries: unknown[] }[]
    profile: { classLevel: number } | null
  }
  expect(file.app).toBe('Studydeck')
  expect(file.version).toBe(3)
  expect(file.notebooks).toHaveLength(1)
  expect(file.notebooks[0]!.subjects.length).toBeGreaterThan(0)
  expect(file.profile?.classLevel).toBe(10)

  const calendar = await call('/api/timetable.ics')
  expect(calendar.status).toBe(200)
  expect(calendar.headers.get('content-type')).toContain('text/calendar')
  const ics = await calendar.text()
  expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
  expect(ics).toContain('RRULE:FREQ=WEEKLY')
  expect(ics).toContain('LOCATION:Room 4')
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)

  expect((await call('/api/workspace', 'DELETE')).status).toBe(200)
  const after = await data()
  // Only the notebook is emptied; the student's class and school week stay.
  expect(after.profile?.classLevel).toBe(10)
  expect(after.subjects).toHaveLength(0)
  expect(after.entries).toHaveLength(0)
  expect(after.notes).toHaveLength(0)
  expect(after.actions).toHaveLength(0)
})

test('a saved action is kept in the notebook and only runs with a key', async () => {
  expect(
    (await call('/api/actions', 'POST', { name: 'Explain it', prompt: 'short' }))
      .status,
  ).toBe(400)
  expect(
    (await call('/api/actions', 'POST', { name: '', prompt: 'Explain this.' }))
      .status,
  ).toBe(400)

  const created = await call('/api/actions', 'POST', {
    name: 'Explain it simply',
    prompt: 'Explain this in plain words, as if I missed the class.',
  })
  expect(created.status).toBe(201)
  const { action } = (await created.json()) as { action: { id: string } }
  expect((await data()).actions.map((item) => item.name)).toEqual([
    'Explain it simply',
  ])

  const edited = await call(`/api/actions/${action.id}`, 'PATCH', {
    name: 'Explain it very simply',
    prompt: 'Explain this in one paragraph of plain words.',
  })
  expect(edited.status).toBe(200)

  // It travels with the notebook, so a backup brings it back.
  const exported = (await (await call('/api/export')).json()) as {
    notebooks: { actions: { name: string; prompt: string }[] }[]
  }
  expect(exported.notebooks[0]!.actions).toMatchObject([
    {
      name: 'Explain it very simply',
      prompt: 'Explain this in one paragraph of plain words.',
    },
  ])

  const note = (await (
    await call('/api/notes', 'POST', {
      title: 'Light reactions',
      body: 'Chlorophyll absorbs light in the thylakoid.',
    })
  ).json()) as { note: { id: string } }

  // One target, not both, and a real target to run over.
  expect(
    (await call(`/api/actions/${action.id}/run`, 'POST', {})).status,
  ).toBe(400)
  expect(
    (
      await call(`/api/actions/${action.id}/run`, 'POST', { noteId: 'not-an-id' })
    ).status,
  ).toBe(404)
  const run = await call(`/api/actions/${action.id}/run`, 'POST', {
    noteId: note.note.id,
  })
  expect(run.status).toBe(503)
  expect(((await run.json()) as { error: string }).error).toContain(
    'Paste an API key',
  )

  expect((await call(`/api/actions/${action.id}`, 'DELETE')).status).toBe(200)
  expect((await data()).actions).toHaveLength(0)
  expect((await call(`/api/actions/${action.id}`, 'DELETE')).status).toBe(404)
})

test('a key saved in the app turns the desk on and never comes back out', async () => {
  const secret = 'sk-or-account-123456'
  const saved = await call('/api/ai/settings', 'PUT', {
    provider: 'openrouter',
    apiKey: secret,
  })
  expect(saved.status).toBe(200)

  const settings = (await (await call('/api/ai/settings')).json()) as {
    source: string
    provider: { id: string; model: string } | null
    saved: { hint: string; provider: string } | null
  }
  expect(settings.source).toBe('account')
  expect(settings.provider?.id).toBe('openrouter')
  expect(JSON.stringify(settings)).not.toContain(secret)
  expect(settings.saved?.hint).toContain('3456')

  const workspace = await data()
  expect(workspace.ai.enabled).toBe(true)
  expect(workspace.ai.provider).toBe('OpenRouter')
  expect(await (await call('/api/export')).text()).not.toContain(secret)

  expect((await call('/api/ai/settings', 'DELETE')).status).toBe(200)
  expect((await data()).ai.enabled).toBe(false)

  for (const body of [
    { provider: 'nope', apiKey: secret },
    { provider: 'openrouter' },
    { provider: 'openrouter', apiKey: 'short' },
    { provider: 'custom', apiKey: secret, baseUrl: 'not-a-url', model: 'm' },
    { provider: 'custom', apiKey: secret, model: '' },
  ]) {
    expect((await call('/api/ai/settings', 'PUT', body)).status).toBe(400)
  }

  // Ollama needs no key, only a base URL pointing at the server.
  expect(
    (
      await call('/api/ai/settings', 'PUT', {
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.2',
      })
    ).status,
  ).toBe(200)
  expect((await data()).ai.provider).toBe('Ollama')
})

test('the wizard payload saves in one call because every entry uses a subject key', async () => {
  const payload = buildSetupPayload({
    classLevel: 10,
    subjectNames: ['Mathematics', 'Science', 'Social Science'],
    days: [0, 1, 2, 3, 4],
    periods: [
      { startMin: 480, endMin: 525, subjectName: 'Mathematics' },
      { startMin: 530, endMin: 575, subjectName: 'Science' },
      { startMin: 580, endMin: 625, subjectName: 'Social Science' },
      { startMin: 630, endMin: 675, subjectName: 'Mathematics' },
      { startMin: 680, endMin: 725, subjectName: 'Science' },
      { startMin: 730, endMin: 775, subjectName: 'Social Science' },
      { startMin: 780, endMin: 825, subjectName: 'Mathematics' },
    ],
    coaching: { days: [1, 3], startMin: 960, endMin: 1050 },
    studyHours: 3,
    tests: [
      { date: '2026-11-22', subjects: ['Social Science'] },
      { date: '2026-11-29', subjects: ['Mathematics', 'Science'] },
    ],
    from: '2026-11-18',
  })

  // An entry keyed by a subject name is exactly what the save step rejects.
  const keys = new Set(payload.subjects.map((subject) => subject.key))
  expect(keys).toEqual(new Set(['s0', 's1', 's2']))
  for (const entry of [...payload.regular, ...payload.revision]) {
    if (entry.kind === 'break' || entry.title === 'Coaching')
      expect(entry.subjectId).toBeNull()
    else expect(keys.has(entry.subjectId!)).toBe(true)
  }
  expect(payload.subjects.find((s) => s.name === 'Social Science')?.examDate).toBe(
    '2026-11-22',
  )
  expect(payload.regular.filter((entry) => entry.kind === 'class')).toHaveLength(37)
  expect(payload.revision.length).toBeGreaterThan(0)

  const response = await call('/api/setup', 'POST', payload)
  expect(response.status).toBe(200)
  const saved = await data()
  expect(saved.profile?.classLevel).toBe(10)
  expect(saved.subjects).toHaveLength(3)
  expect(saved.subjects.find((s) => s.name === 'Social Science')?.examDate).toBe(
    '2026-11-22',
  )
  expect(saved.entries.filter((entry) => entry.plan === 'regular')).toHaveLength(
    payload.regular.length,
  )
  expect(saved.entries.filter((entry) => entry.plan === 'intensive')).toHaveLength(
    payload.revision.length,
  )
})
