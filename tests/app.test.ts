import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Miniflare } from 'miniflare'
import type { Note, Subject, Task, WorkspaceData } from '../src/shared/types'
import { buildSetupPayload } from '../src/client/setupPayload'
import { createApp } from '../src/worker/app'
import { currentUser, type Env } from '../src/worker/auth'

const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: 'test-db',
        compatibilityDate: '2026-11-11',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents:
                'export default { fetch() { return new Response("test") } }',
            },
          },
        },
        env: { DB: { type: 'd1', name: 'studydeck-test' } },
      },
    },
  ],
  port: 0,
})
let env: Env
beforeAll(async () => {
  const db = await runtime.getD1Database('DB')
  env = {
    DB: db as unknown as D1Database,
    APP_ORIGIN: 'https://app.example.test',
    ASSETS: {
      fetch: async () => new Response('public page'),
    } as unknown as Fetcher,
  }
}, 20_000)
afterAll(() => runtime.dispose())

// This identity seam exists only in the app factory. The Worker entrypoint
// never reads these test headers and always calls the real auth SDK.
const app = createApp(async (request) => {
  const sub = request.headers.get('test-user')
  return sub ? { sub } : null
})
const call = (
  path: string,
  user?: string,
  method = 'GET',
  body?: unknown,
  origin = env.APP_ORIGIN!,
) =>
  app.request(
    `https://app.example.test${path}`,
    {
      method,
      headers: {
        ...(user ? { 'test-user': user } : {}),
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )

const data = async (user: string) =>
  (await (await call('/api/data', user)).json()) as WorkspaceData

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

test('signed-out requests are refused while public pages and health stay open', async () => {
  for (const [path, method] of [
    ['/api/data', 'GET'],
    ['/api/setup', 'POST'],
    ['/api/tasks', 'POST'],
    ['/api/notes', 'POST'],
    ['/api/subjects', 'POST'],
    ['/api/syllabus', 'POST'],
    ['/api/entries', 'POST'],
    ['/api/ai/ask', 'POST'],
    ['/api/ai/summarize', 'POST'],
    ['/api/export', 'GET'],
    ['/api/timetable.ics', 'GET'],
    ['/api/workspace', 'DELETE'],
    ['/api/ai/settings', 'GET'],
    ['/api/ai/settings', 'PUT'],
    ['/api/ai/settings', 'DELETE'],
  ] as const) {
    const response = await call(path, undefined, method)
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect(await (await call('/')).text()).toBe('public page')
  expect((await call('/api/health')).status).toBe(200)
})

test('a new workspace starts empty and every record stays with its owner', async () => {
  const alice = await data('alice')
  expect(alice.subjects).toHaveLength(0)
  expect(alice.entries).toHaveLength(0)
  expect(alice.profile).toBeNull()
  expect(alice.ai.enabled).toBe(false)
  expect((await data('bob')).subjects).toHaveLength(0)

  const created = await call('/api/notes', 'alice', 'POST', {
    title: '  Trig identities ',
    body: 'sin²x + cos²x = 1',
  })
  expect(created.status).toBe(201)
  const { note } = (await created.json()) as { note: Note }
  expect(note.title).toBe('Trig identities')

  expect((await data('bob')).notes.some((item) => item.id === note.id)).toBe(false)
  expect((await call(`/api/notes/${note.id}`, 'bob', 'DELETE')).status).toBe(404)
  expect(
    (await call(`/api/notes/${note.id}`, 'bob', 'PATCH', { body: 'stolen' })).status,
  ).toBe(404)

  const updated = await call(`/api/notes/${note.id}`, 'alice', 'PATCH', {
    title: 'Trig identities',
    body: 'sin²x + cos²x = 1, and tan x = sin x / cos x',
  })
  expect(updated.status).toBe(200)

  const task = await call('/api/tasks', 'alice', 'POST', {
    title: 'Finish problem set',
    dueDate: '2026-12-01',
    priority: 'high',
    done: false,
  })
  expect(task.status).toBe(201)
  const { task: saved } = (await task.json()) as { task: Task }
  expect((await call(`/api/tasks/${saved.id}`, 'bob', 'DELETE')).status).toBe(404)
  expect((await call(`/api/tasks/${saved.id}`, 'alice', 'DELETE')).status).toBe(200)

  const subject = await call('/api/subjects', 'alice', 'POST', {
    name: 'Chemistry',
    color: '#40607a',
  })
  expect(subject.status).toBe(201)
  const { subject: chem } = (await subject.json()) as { subject: Subject }
  expect(chem.name).toBe('Chemistry')
})

test('class setup stores the profile, resolves subject keys and keeps notes', async () => {
  const response = await call('/api/setup', 'alice', 'POST', setupBody)
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

  const bob = await data('bob')
  expect(bob.profile).toBeNull()
  expect(bob.subjects).toHaveLength(0)

  // Re-running keeps the note and reuses the subject row by name.
  const again = await call('/api/setup', 'alice', 'POST', {
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
    expect((await call('/api/setup', 'alice', 'POST', broken)).status).toBe(400)
  }
})

test('syllabus progress is saved per owner and only on owned subjects', async () => {
  const alice = await data('alice')
  const subject = alice.subjects[0]!
  expect(subject).toBeDefined()

  const tick = await call('/api/syllabus', 'alice', 'POST', {
    subjectId: subject.id,
    chapter: 'Light – Reflection and Refraction',
    done: true,
  })
  expect(tick.status).toBe(200)
  let after = await data('alice')
  expect(after.syllabus).toEqual([
    { subjectId: subject.id, chapter: 'Light – Reflection and Refraction' },
  ])

  // Ticking twice keeps one row instead of piling up duplicates.
  expect(
    (
      await call('/api/syllabus', 'alice', 'POST', {
        subjectId: subject.id,
        chapter: 'Light – Reflection and Refraction',
        done: true,
      })
    ).status,
  ).toBe(200)
  after = await data('alice')
  expect(after.syllabus).toHaveLength(1)

  // Another student can neither tick nor see it.
  expect(
    (
      await call('/api/syllabus', 'bob', 'POST', {
        subjectId: subject.id,
        chapter: 'Light – Reflection and Refraction',
        done: true,
      })
    ).status,
  ).toBe(404)
  expect((await data('bob')).syllabus).toHaveLength(0)

  // Clearing a chapter removes the tick.
  expect(
    (
      await call('/api/syllabus', 'alice', 'POST', {
        subjectId: subject.id,
        chapter: 'Light – Reflection and Refraction',
        done: false,
      })
    ).status,
  ).toBe(200)
  expect((await data('alice')).syllabus).toHaveLength(0)

  for (const body of [
    { subjectId: subject.id, chapter: '   ', done: true },
    { chapter: 'Light', done: true },
    { subjectId: 'not-a-real-id', chapter: 'Light', done: true },
  ]) {
    const status = (await call('/api/syllabus', 'alice', 'POST', body)).status
    expect(status === 400 || status === 404).toBe(true)
  }
})

test('timetable, revision plan and validation rules hold', async () => {
  const week = await call('/api/entries', 'alice', 'POST', {
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

  const plan = await call('/api/entries/plan', 'alice', 'POST', {
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

  const cleared = await call('/api/entries/plan', 'alice', 'POST', { entries: [] })
  expect(((await cleared.json()) as { entries: unknown[] }).entries).toHaveLength(0)

  expect(
    (
      await call('/api/entries', 'alice', 'POST', {
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
      await call('/api/entries', 'alice', 'POST', {
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
    expect((await call(path, 'alice', 'POST', body)).status).toBe(400)
  }
  expect(
    (await call('/api/notes', 'alice', 'POST', { body: 'x'.repeat(9000) })).status,
  ).toBe(400)
  expect(
    (await call('/api/notes', 'alice', 'POST', { body: 'x'.repeat(300_000) })).status,
  ).toBe(413)
})

test('foreign origins are refused and the AI desk reports its missing key', async () => {
  expect(
    (
      await call(
        '/api/tasks',
        'alice',
        'POST',
        { title: 'Nope', priority: 'low', done: false },
        'https://foreign.example',
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await app.request(
        'https://app.example.test/api/tasks',
        {
          method: 'POST',
          headers: { 'test-user': 'alice', 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Nope' }),
        },
        env,
      )
    ).status,
  ).toBe(403)

  const ask = await call('/api/ai/ask', 'alice', 'POST', {
    question: 'What is photosynthesis?',
  })
  expect(ask.status).toBe(503)
  expect(((await ask.json()) as { error: string }).error).toContain(
    'Paste an API key',
  )
  expect((await call('/api/ai/summarize', 'alice', 'POST', {})).status).toBe(503)
})

test('missing database reports setup and local preview identity never activates on hosted origins', async () => {
  const noDb = await app.request(
    'https://app.example.test/api/data',
    { headers: { 'test-user': 'alice' } },
    { ...env, DB: undefined },
  )
  expect(noDb.status).toBe(503)
  expect(
    await currentUser(new Request('https://app.example.test/'), {} as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {
      APP_ORIGIN: 'https://app.example.test',
    } as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('http://localhost:5000/'), {} as Env),
  ).toMatchObject({ sub: 'local-preview' })

  // The proxied dev-server opt-in is exact-host and never applies to hosted origins.
  expect(
    await currentUser(new Request('https://pv-abc.style.dev/'), {
      DEV_PREVIEW_HOST: 'pv-abc.style.dev',
    } as Env),
  ).toMatchObject({ sub: 'local-preview' })
  expect(
    await currentUser(new Request('https://other.style.dev/'), {
      DEV_PREVIEW_HOST: 'pv-abc.style.dev',
    } as Env),
  ).toBeNull()
  expect(
    await currentUser(new Request('https://pv-abc.style.dev/'), {
      DEV_PREVIEW_HOST: 'pv-abc.style.dev',
      APP_ORIGIN: 'https://app.example.test',
    } as Env),
  ).toBeNull()
})

test('a student can export their data, take the timetable to a calendar and reset', async () => {
  const setup = await call('/api/setup', 'carol', 'POST', {
    ...setupBody,
    subjects: [
      { key: 'bio', name: 'Biology', color: '#3f6b52', teacher: '', examDate: '2026-12-02' },
    ],
    regular: [
      {
        subjectId: 'bio',
        title: 'Biology',
        kind: 'class',
        plan: 'regular',
        day: 1,
        startMin: 480,
        endMin: 525,
        room: 'Room 9',
        date: '',
      },
    ],
    revision: [
      {
        subjectId: 'bio',
        title: 'Biology revision',
        kind: 'study',
        plan: 'intensive',
        date: '2026-12-01',
        day: 1,
        startMin: 960,
        endMin: 1010,
        room: '',
      },
    ],
  })
  expect(setup.status).toBe(200)

  const exported = await call('/api/export', 'carol')
  expect(exported.status).toBe(200)
  expect(exported.headers.get('content-disposition')).toContain('studydeck-')
  const file = (await exported.json()) as {
    app: string
    subjects: { name: string }[]
    entries: unknown[]
    profile: { classLevel: number } | null
  }
  expect(file.app).toBe('Studydeck')
  expect(file.profile?.classLevel).toBe(10)
  expect(file.subjects[0]?.name).toBe('Biology')
  expect(file.entries).toHaveLength(2)

  const calendar = await call('/api/timetable.ics', 'carol')
  expect(calendar.status).toBe(200)
  expect(calendar.headers.get('content-type')).toContain('text/calendar')
  const ics = await calendar.text()
  expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
  expect(ics).toContain('SUMMARY:Biology')
  expect(ics).toContain('RRULE:FREQ=WEEKLY')
  expect(ics).toContain('LOCATION:Room 9')
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  // Another student's calendar is their own.
  expect(await (await call('/api/timetable.ics', 'dave')).text()).not.toContain(
    'Biology',
  )

  // Only alice's neighbour is cleared, and only for the caller.
  expect(
    (
      await call('/api/workspace', 'carol', 'DELETE', undefined, 'https://foreign.example')
    ).status,
  ).toBe(403)
  expect((await call('/api/workspace', 'carol', 'DELETE')).status).toBe(200)
  const after = await data('carol')
  expect(after.profile).toBeNull()
  expect(after.subjects).toHaveLength(0)
  expect(after.entries).toHaveLength(0)
  expect((await data('alice')).subjects.length).toBeGreaterThan(0)
})

test('a student can connect their own AI key and it never comes back out', async () => {
  const secret = 'sk-or-account-123456'
  const saved = await call('/api/ai/settings', 'erin', 'PUT', {
    provider: 'openrouter',
    apiKey: secret,
  })
  expect(saved.status).toBe(200)

  const settings = (await (await call('/api/ai/settings', 'erin')).json()) as {
    source: string
    provider: { id: string; model: string } | null
    saved: { hint: string; provider: string } | null
  }
  expect(settings.source).toBe('account')
  expect(settings.provider?.id).toBe('openrouter')
  expect(settings.saved?.provider).toBe('openrouter')
  // The key itself is never returned, only a recognisable suffix.
  expect(JSON.stringify(settings)).not.toContain(secret)
  expect(settings.saved?.hint).toContain('3456')

  // The key turns the desk on for its owner and nobody else.
  const erin = await data('erin')
  expect(erin.ai.enabled).toBe(true)
  expect(erin.ai.provider).toBe('OpenRouter')
  expect((await data('frank')).ai.enabled).toBe(false)
  expect(
    await (await call('/api/export', 'erin')).text(),
  ).not.toContain(secret)

  // Removing the key turns the desk off again.
  expect((await call('/api/ai/settings', 'erin', 'DELETE')).status).toBe(200)
  expect((await (await call('/api/ai/settings', 'erin')).json()) as { source: unknown }).toMatchObject({ source: null })
  expect((await data('erin')).ai.enabled).toBe(false)

  for (const body of [
    { provider: 'nope', apiKey: secret },
    { provider: 'openrouter' },
    { provider: 'openrouter', apiKey: 'short' },
    { provider: 'custom', apiKey: secret, baseUrl: 'not-a-url', model: 'm' },
    { provider: 'custom', apiKey: secret, model: '' },
  ]) {
    expect((await call('/api/ai/settings', 'erin', 'PUT', body)).status).toBe(400)
  }

  // Ollama needs no key, only a base URL pointing at the server.
  expect(
    (
      await call('/api/ai/settings', 'frank', 'PUT', {
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.2',
      })
    ).status,
  ).toBe(200)
  expect((await data('frank')).ai.provider).toBe('Ollama')
})

test('the wizard payload saves in one call because every entry uses a subject key', async () => {
  const payload = buildSetupPayload({
    classLevel: 10,
    subjectNames: ['Mathematics', 'Science', 'Social Science'],
    days: [0, 1, 2, 3, 4],
    start: 480,
    end: 870,
    periodLength: 45,
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
    if (entry.kind === 'break') expect(entry.subjectId).toBeNull()
    else expect(keys.has(entry.subjectId!)).toBe(true)
  }
  expect(payload.subjects.find((s) => s.name === 'Social Science')?.examDate).toBe(
    '2026-11-22',
  )
  expect(payload.regular.filter((entry) => entry.kind === 'class')).toHaveLength(35)
  expect(payload.revision.length).toBeGreaterThan(0)

  const response = await call('/api/setup', 'wizard', 'POST', payload)
  expect(response.status).toBe(200)
  const saved = await data('wizard')
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
