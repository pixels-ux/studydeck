import { afterEach, expect, test } from 'bun:test'
import type { DayLog, Entry, WorkspaceData } from '../src/shared/types'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import type { Env } from '../src/server/env'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const DATE = '2026-11-23'
const WEEKDAY = (new Date(`${DATE}T00:00:00Z`).getUTCDay() + 6) % 7

function harness(options: Env = {}) {
  const app = createApp(openDatabase(':memory:'), options)
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
  return { app, call }
}

const checkIn = {
  date: DATE,
  school: [{ subjectId: null, title: 'Mathematics', topic: 'Quadratic equations' }],
  coaching: {
    attending: true,
    startMin: 16 * 60,
    endMin: 17 * 60 + 30,
    topic: 'Refraction problems',
  },
  homework: [
    {
      id: 'hw-1',
      subjectId: null,
      source: 'school',
      title: 'Exercise 4.2',
      minutes: 45,
    },
  ],
  freeFrom: 18 * 60,
  freeUntil: 21 * 60 + 30,
  brief: '',
}

async function withTimetable(call: ReturnType<typeof harness>['call']) {
  const classEntry = await call('/api/entries', 'POST', {
    title: 'Mathematics',
    kind: 'class',
    plan: 'regular',
    day: WEEKDAY,
    startMin: 8 * 60,
    endMin: 8 * 60 + 45,
    room: 'Room 4',
    subjectId: null,
    date: '',
  })
  expect(classEntry.status).toBe(201)
}

test('the day loads from the real timetable and saves what was taught', async () => {
  const { call } = harness()
  await withTimetable(call)

  const before = (await (await call(`/api/day?date=${DATE}`)).json()) as {
    date: string
    log: DayLog | null
    classes: Entry[]
  }
  expect(before.date).toBe(DATE)
  expect(before.log).toBeNull()
  expect(before.classes).toHaveLength(1)
  expect(before.classes[0]!.title).toBe('Mathematics')

  const saved = await call('/api/day', 'PUT', checkIn)
  expect(saved.status).toBe(200)
  const { log } = (await saved.json()) as { log: DayLog }
  expect(log.school[0]!.topic).toBe('Quadratic equations')
  expect(log.coaching?.topic).toBe('Refraction problems')
  expect(log.homework[0]!.minutes).toBe(45)
  expect(log.freeFrom).toBe(18 * 60)

  const again = (await (await call(`/api/day?date=${DATE}`)).json()) as {
    log: DayLog
  }
  expect(again.log.coaching?.startMin).toBe(16 * 60)
  expect(again.log.homework).toHaveLength(1)

  for (const broken of [
    { ...checkIn, freeUntil: 9 * 60 },
    { ...checkIn, homework: [{ ...checkIn.homework[0], minutes: 700 }] },
    { ...checkIn, school: [{ subjectId: null, title: '', topic: 'x' }] },
    { ...checkIn, date: 'Monday' },
    { ...checkIn, coaching: { attending: true, startMin: 600, endMin: 500, topic: '' } },
  ]) {
    expect((await call('/api/day', 'PUT', broken)).status).toBe(400)
  }
  expect(
    (
      await call(
        '/api/day',
        'PUT',
        checkIn,
        'https://foreign.example',
      )
    ).status,
  ).toBe(403)
})

test('only the chosen day of the plan is replaced', async () => {
  const { call } = harness()
  const other = '2026-11-24'

  const block = (date: string, title: string) => ({
    subjectId: null,
    title,
    kind: 'study',
    plan: 'intensive',
    day: (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7,
    startMin: 18 * 60,
    endMin: 18 * 60 + 40,
    room: '',
    date,
  })

  expect(
    (
      await call('/api/entries/day', 'POST', {
        date: other,
        entries: [block(other, 'Other evening')],
      })
    ).status,
  ).toBe(200)

  const replaced = await call('/api/entries/day', 'POST', {
    date: DATE,
    entries: [block(DATE, 'Tonight A'), block(DATE, 'Tonight B')],
  })
  expect(replaced.status).toBe(200)
  const { entries } = (await replaced.json()) as { entries: Entry[] }
  expect(entries).toHaveLength(2)

  const data = (await (await call('/api/data')).json()) as WorkspaceData
  const forDate = data.entries.filter((entry) => entry.date === DATE)
  expect(forDate.map((entry) => entry.title)).toEqual(['Tonight A', 'Tonight B'])
  expect(
    data.entries.some((entry) => entry.date === other && entry.title === 'Other evening'),
  ).toBe(true)

  // A block dated for another day would silently move the plan, so it is refused.
  expect(
    (
      await call('/api/entries/day', 'POST', {
        date: DATE,
        entries: [block(other, 'Wrong day')],
      })
    ).status,
  ).toBe(400)
})

test('the AI brief reads the saved day and is kept for the next visit', async () => {
  const { call } = harness({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-123456' })
  await withTimetable(call)
  await call('/api/day', 'PUT', checkIn)

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '- Start with Exercise 4.2 while the refraction class is fresh.\n- Worth checking: can you explain critical angle?',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch

  const brief = await call('/api/day/brief', 'POST', { date: DATE })
  expect(brief.status).toBe(200)
  const result = (await brief.json()) as { brief: string; remaining: number }
  expect(result.brief).toContain('Exercise 4.2')
  expect(result.remaining).toBe(39)

  const saved = (await (await call(`/api/day?date=${DATE}`)).json()) as {
    log: DayLog
  }
  expect(saved.log.brief).toContain('critical angle')
})

test('a brief needs the day saved first, and an AI key', async () => {
  const { call } = harness()
  expect(
    (await call('/api/day/brief', 'POST', { date: DATE })).status,
  ).toBe(400)

  await call('/api/day', 'PUT', checkIn)
  expect(
    (await call('/api/day/brief', 'POST', { date: DATE })).status,
  ).toBe(503)
  expect(
    (await call('/api/day/brief', 'POST', { date: 'today' })).status,
  ).toBe(400)
})
