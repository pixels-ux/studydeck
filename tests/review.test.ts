import { expect, test } from 'bun:test'
import type { ReviewCard, ReviewSummary, WorkspaceData } from '../src/shared/types'
import { cardKey } from '../src/shared/revision.ts'
import { addDays, nextGap, nextReview } from '../src/shared/review.ts'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import { scopedOwner } from '../src/server/db'
import { reviewStats } from '../src/server/review'
import type { SqlDatabase } from '../src/server/sql'

const deck = [
  'Q: What is light?',
  'A: Both a wave and a particle.',
  '',
  'Q: What is refraction?',
  'A: The bending of light as it changes medium.',
].join('\n')

test('the schedule starts at a day and grows with the ease', () => {
  const first = nextReview(null, 'good', '2026-11-25')
  expect(first).toMatchObject({ intervalDays: 1, ease: 250, dueDate: '2026-11-26' })

  const second = nextReview(first, 'good', '2026-11-26')
  expect(second.intervalDays).toBe(3)
  expect(second.dueDate).toBe('2026-11-29')

  const easy = nextReview(first, 'easy', '2026-11-26')
  expect(easy.intervalDays).toBe(3)
  expect(easy.ease).toBe(265)

  const hard = nextReview(first, 'hard', '2026-11-26')
  expect(hard.intervalDays).toBe(1)
  expect(hard.ease).toBe(235)
})

test('a missed card comes back tomorrow and loses ease', () => {
  const memory = { intervalDays: 10, ease: 250, lapses: 1 }
  const again = nextReview(memory, 'again', '2026-11-25')
  expect(again).toMatchObject({
    intervalDays: 0,
    ease: 230,
    lapses: 2,
    dueDate: '2026-11-26',
  })
  // Ease never falls below the floor, and the interval never exceeds a year.
  let low = { intervalDays: 1, ease: 130, lapses: 0 }
  for (let index = 0; index < 20; index += 1)
    low = nextReview(low, 'again', '2026-11-25')
  expect(low.ease).toBe(130)
  expect(nextReview({ intervalDays: 300, ease: 250, lapses: 0 }, 'easy', '2026-11-25').intervalDays).toBe(365)
  expect(nextGap(null, 'again')).toBe('tomorrow')
  expect(nextGap(null, 'good')).toBe('in 1 day')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
})

const call = (app: ReturnType<typeof createApp>, path: string, method = 'GET', body?: unknown) =>
  app.request(`http://localhost${path}`, {
    method,
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function seeded() {
  const db = openDatabase(':memory:')
  const app = createApp(db, {})
  const data = (await (await call(app, '/api/data')).json()) as WorkspaceData
  return { db, app, owner: scopedOwner(data.notebookId) }
}

/** A row in the history, as an answer on that day would have written it. */
async function logged(
  db: SqlDatabase,
  owner: string,
  day: string,
  result: string,
  key = 'abc',
) {
  await db
    .prepare(
      'INSERT INTO review_log (owner_sub, note_id, card_key, result, day, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(owner, 'note-1', key, result, day, Date.parse(`${day}T12:00:00Z`))
    .run()
}

test('the streak counts days in a row, and today stays open', async () => {
  const { db, owner } = await seeded()
  for (const day of ['2026-11-23', '2026-11-24', '2026-11-25'])
    await logged(db, owner, day, 'good')

  expect(await reviewStats(db, owner, '2026-11-25')).toMatchObject({
    streak: 3,
    bestStreak: 3,
    missedDays: 0,
    answeredToday: 1,
    recalled: 100,
    answers: 3,
    total: 3,
  })
  // Nothing answered yet today: yesterday's run is not broken.
  expect((await reviewStats(db, owner, '2026-11-26')).streak).toBe(3)
  // A whole day with no answers does break it.
  expect((await reviewStats(db, owner, '2026-11-27')).streak).toBe(0)
})

test('missed days and the recall share are read from the answers', async () => {
  const { db, owner } = await seeded()
  await logged(db, owner, '2026-11-10', 'again')
  await logged(db, owner, '2026-11-25', 'easy')

  const stats = await reviewStats(db, owner, '2026-11-25')
  // The 24th back to the 10th, which was answered, so fourteen days are empty.
  expect(stats.missedDays).toBe(14)
  expect(stats.streak).toBe(1)
  expect(stats.bestStreak).toBe(1)
  expect(stats.answers).toBe(2)
  expect(stats.recalled).toBe(50)
})

test('the best run survives a break, and a new notebook owes no days', async () => {
  const { db, owner } = await seeded()
  for (const day of [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-20',
    '2026-11-21',
  ])
    await logged(db, owner, day, 'hard')

  const stats = await reviewStats(db, owner, '2026-11-25')
  expect(stats.bestStreak).toBe(3)
  expect(stats.streak).toBe(0)
  expect(stats.answers).toBe(5)
  expect(stats.recalled).toBe(0)

  const fresh = await seeded()
  expect(await reviewStats(fresh.db, fresh.owner, '2026-11-25')).toMatchObject({
    streak: 0,
    bestStreak: 0,
    missedDays: 0,
    total: 0,
  })
})

test('an answer is kept in the history and travels in a backup', async () => {
  const source = createApp(openDatabase(':memory:'), {})
  const saved = await call(source, '/api/notes', 'POST', {
    subjectId: null,
    title: 'Flashcards · Light',
    body: deck,
  })
  const note = ((await saved.json()) as { note: { id: string } }).note
  await call(source, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('What is light?'),
    result: 'good',
  })

  const data = (await (await call(source, '/api/data')).json()) as WorkspaceData
  expect(data.reviewStats).toMatchObject({
    streak: 1,
    answeredToday: 1,
    answers: 1,
    total: 1,
  })

  const file = (await (await call(source, '/api/export')).json()) as {
    notebooks: { reviewLog: { noteId: string }[] }[]
  }
  expect(file.notebooks[0]!.reviewLog).toHaveLength(1)

  const target = createApp(openDatabase(':memory:'), {})
  expect((await call(target, '/api/import', 'POST', file)).status).toBe(200)
  const imported = (await (await call(target, '/api/data')).json()) as WorkspaceData
  expect(imported.reviewStats.total).toBe(1)
  expect(imported.reviewStats.streak).toBe(1)
})

test('a new deck is due at once, and an answer schedules it', async () => {
  const app = createApp(openDatabase(':memory:'), {})
  const saved = await call(app, '/api/notes', 'POST', {
    subjectId: null,
    title: 'Flashcards · Light',
    body: deck,
  })
  const note = ((await saved.json()) as { note: { id: string } }).note

  const first = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
  }
  expect(first.cards).toHaveLength(2)
  expect(first.summary).toEqual({
    due: 0,
    fresh: 2,
    total: 2,
    nextDue: '',
  })
  expect(first.cards[0]?.fresh).toBe(true)

  const answer = await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('What is light?'),
    result: 'good',
  })
  expect(answer.status).toBe(200)
  const graded = (await answer.json()) as { card: ReviewCard }
  const today = new Date().toISOString().slice(0, 10)
  expect(graded.card.dueDate).toBe(addDays(today, 1))
  expect(graded.card.intervalDays).toBe(1)

  const after = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
  }
  expect(after.cards).toHaveLength(1)
  expect(after.summary.due).toBe(0)
  expect(after.summary.fresh).toBe(1)
  expect(after.summary.total).toBe(2)
  expect(after.summary.nextDue).toBe(addDays(today, 1))

  const data = (await (await call(app, '/api/data')).json()) as WorkspaceData
  expect(data.review).toMatchObject({ fresh: 1, total: 2 })
})

test('a card that is not in the deck, or a bad answer, is refused', async () => {
  const app = createApp(openDatabase(':memory:'), {})
  const saved = await call(app, '/api/notes', 'POST', {
    subjectId: null,
    title: 'Flashcards · Light',
    body: deck,
  })
  const note = ((await saved.json()) as { note: { id: string } }).note
  const real = cardKey('What is light?')

  const missing = await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('A question that is not here'),
    result: 'good',
  })
  expect(missing.status).toBe(404)

  const nonsense = await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: real,
    result: 'brilliant',
  })
  expect(nonsense.status).toBe(400)

  const wrongNote = await call(app, '/api/review', 'POST', {
    noteId: crypto.randomUUID(),
    cardKey: real,
    result: 'good',
  })
  expect(wrongNote.status).toBe(404)
})

test('deleting a deck deletes its history', async () => {
  const app = createApp(openDatabase(':memory:'), {})
  const saved = await call(app, '/api/notes', 'POST', {
    subjectId: null,
    title: 'Flashcards · Light',
    body: deck,
  })
  const note = ((await saved.json()) as { note: { id: string } }).note
  await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('What is light?'),
    result: 'easy',
  })
  await call(app, `/api/notes/${note.id}`, 'DELETE')
  const queue = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
  }
  expect(queue.summary.total).toBe(0)
})
