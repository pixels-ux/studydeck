import { expect, test } from 'bun:test'
import type {
  ReviewCard,
  ReviewDeck,
  ReviewSummary,
  WorkspaceData,
} from '../src/shared/types'
import { cardKey } from '../src/shared/revision.ts'
import { addDays, nextGap, nextReview } from '../src/shared/review.ts'
import { openDatabase } from '../src/node/sqlite'
import { createApp } from '../src/server/app'
import { scopedOwner } from '../src/server/db'
import {
  gradeCard,
  reviewDecks,
  reviewQueue,
  reviewStats,
  undoLastReview,
} from '../src/server/review'
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

test('every deck is listed with its due and total card counts', async () => {
  const app = createApp(openDatabase(':memory:'), {})
  const made = async (title: string, body: string) => {
    const saved = await call(app, '/api/notes', 'POST', {
      subjectId: null,
      title,
      body,
    })
    return ((await saved.json()) as { note: { id: string } }).note
  }

  const light = await made('Flashcards · Light', deck)
  await made(
    'Flashcards · Sound',
    ['Q: How does sound travel?', 'A: As a wave through a medium.'].join('\n'),
  )
  await made('Slides · Light', 'Light\n- travels in straight lines')

  const first = (await (await call(app, '/api/review/decks')).json()) as {
    decks: ReviewDeck[]
  }
  // Slides are not decks, and the deck with the most waiting comes first.
  expect(
    first.decks.map((item) => [item.noteTitle, item.due, item.fresh, item.total]),
  ).toEqual([
    ['Flashcards · Light', 0, 2, 2],
    ['Flashcards · Sound', 0, 1, 1],
  ])

  const today = new Date().toISOString().slice(0, 10)
  await call(app, '/api/review', 'POST', {
    noteId: light.id,
    cardKey: cardKey('What is light?'),
    result: 'good',
  })

  const after = (await (await call(app, '/api/review/decks')).json()) as {
    decks: ReviewDeck[]
  }
  const lit = after.decks.find((item) => item.noteId === light.id)!
  expect(lit).toMatchObject({ due: 0, fresh: 1, total: 2 })
  expect(lit.nextDue).toBe(addDays(today, 1))
  // The deck counts add up to the queue's own summary.
  const queue = (await (await call(app, '/api/review')).json()) as {
    summary: ReviewSummary
  }
  expect(queue.summary.due + queue.summary.fresh).toBe(
    after.decks.reduce((sum, item) => sum + item.due + item.fresh, 0),
  )
})

test('one deck can be reviewed on its own, counted the same way as the list', async () => {
  const { db, app, owner } = await seeded()
  const made = async (title: string, body: string) => {
    const saved = await call(app, '/api/notes', 'POST', {
      subjectId: null,
      title,
      body,
    })
    return ((await saved.json()) as { note: { id: string } }).note
  }

  const light = await made('Flashcards · Light', deck)
  const sound = await made(
    'Flashcards · Sound',
    ['Q: How does sound travel?', 'A: As a wave through a medium.'].join('\n'),
  )

  // One card of Light was answered two days ago, so it is waiting again.
  const today = '2026-11-26'
  const answered = await gradeCard(
    db,
    owner,
    light.id,
    cardKey('What is light?'),
    'good',
    '2026-11-24',
  )
  expect(answered.ok).toBe(true)

  const all = await reviewQueue(db, owner, today)
  expect(all.summary).toEqual({
    due: 1,
    fresh: 2,
    total: 3,
    nextDue: '',
  })

  // The list and the queue are two readings of the same counts.
  const decks = await reviewDecks(db, owner, today)
  expect(
    decks.map((item) => [item.noteTitle, item.due, item.fresh, item.total]),
  ).toEqual([
    ['Flashcards · Light', 1, 1, 2],
    ['Flashcards · Sound', 0, 1, 1],
  ])
  expect(decks.reduce((sum, item) => sum + item.due + item.fresh, 0)).toBe(
    all.summary.due + all.summary.fresh,
  )

  const onlySound = await reviewQueue(db, owner, today, 40, sound.id)
  expect(onlySound.cards).toHaveLength(1)
  expect(onlySound.cards.every((card) => card.noteId === sound.id)).toBe(true)
  expect(onlySound.summary).toEqual({
    due: 0,
    fresh: 1,
    total: 1,
    nextDue: '',
  })

  const onlyLight = await reviewQueue(db, owner, today, 40, light.id)
  expect(onlyLight.summary).toEqual({
    due: 1,
    fresh: 1,
    total: 2,
    nextDue: '',
  })
  // The waiting card comes before the new one.
  expect(onlyLight.cards.map((card) => card.question)).toEqual([
    'What is light?',
    'What is refraction?',
  ])
  expect(onlyLight.cards[0]?.dueDate).toBe('2026-11-25')

  // The route passes the deck through, and an unknown deck hands out nothing.
  const viaRoute = (await (await call(app, `/api/review?deck=${sound.id}`)).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
  }
  expect(viaRoute.summary.total).toBe(1)
  expect(viaRoute.cards[0]?.noteTitle).toBe('Flashcards · Sound')

  const missing = await reviewQueue(db, owner, today, 40, crypto.randomUUID())
  expect(missing.summary.total).toBe(0)
  expect(missing.cards).toHaveLength(0)
})

/** One request addressed to a particular notebook, as the rail sends it. */
const inBook = (
  app: ReturnType<typeof createApp>,
  notebook: string,
  path: string,
  method = 'GET',
  body?: unknown,
) =>
  app.request(`http://localhost${path}`, {
    method,
    headers: {
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
      'x-notebook': notebook,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

test('the queue counts and names cards from every notebook', async () => {
  const app = createApp(openDatabase(':memory:'), {})
  const data = (await (await call(app, '/api/data')).json()) as WorkspaceData
  const home = data.notebookId
  const made = (await (
    await call(app, '/api/notebooks', 'POST', { name: 'Biology' })
  ).json()) as { notebook: { id: string } }
  const biology = made.notebook.id

  const add = async (notebook: string, title: string, body: string) => {
    const saved = await inBook(app, notebook, '/api/notes', 'POST', {
      subjectId: null,
      title,
      body,
    })
    return ((await saved.json()) as { note: { id: string } }).note
  }
  await add(home, 'Flashcards · Light', deck)
  const cells = await add(
    biology,
    'Flashcards · Cells',
    ['Q: What is a cell?', 'A: The unit of life.'].join('\n'),
  )

  // The cards of both books, each labelled with the book it lives in.
  const queue = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
  }
  expect(queue.summary).toEqual({ due: 0, fresh: 3, total: 3, nextDue: '' })
  expect(queue.cards.map((card) => card.notebookName).sort()).toEqual([
    'Biology',
    'My notebook',
    'My notebook',
  ])
  expect(queue.cards.find((card) => card.noteId === cells.id)).toMatchObject({
    notebookId: biology,
    notebookName: 'Biology',
  })

  // Today, the rail badge and the tab title read that same total.
  const today = (await (await call(app, '/api/data')).json()) as WorkspaceData
  expect(today.review).toMatchObject({ fresh: 3, total: 3 })

  // A card from the other book can be answered from this screen.
  const graded = await call(app, '/api/review', 'POST', {
    noteId: cells.id,
    cardKey: cardKey('What is a cell?'),
    result: 'good',
  })
  expect(graded.status).toBe(200)
  expect(((await graded.json()) as { card: ReviewCard }).card).toMatchObject({
    notebookId: biology,
    notebookName: 'Biology',
  })

  const after = (await (await call(app, '/api/review')).json()) as {
    summary: ReviewSummary
    undo: boolean
  }
  expect(after.summary).toMatchObject({ fresh: 2, total: 3 })
  expect(after.undo).toBe(true)

  // One step back reaches into the other notebook too.
  expect((await call(app, '/api/review/undo', 'POST')).status).toBe(200)
  const again = (await (await call(app, '/api/review')).json()) as {
    summary: ReviewSummary
  }
  expect(again.summary).toMatchObject({ fresh: 3, total: 3 })
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

/** A workspace with one two-card deck, and the note it lives in. */
async function withDeck(title = 'Flashcards · Light') {
  const { db, app, owner } = await seeded()
  const saved = await call(app, '/api/notes', 'POST', {
    subjectId: null,
    title,
    body: deck,
  })
  const note = ((await saved.json()) as { note: { id: string } }).note
  return { db, app, owner, note }
}

test('the last answer can be taken back, and the card is new again', async () => {
  const { app, note } = await withDeck()

  // Nothing has been answered, so there is nothing to take back.
  expect((await call(app, '/api/review/undo', 'POST')).status).toBe(409)

  const answered = await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('What is light?'),
    result: 'good',
  })
  expect(answered.status).toBe(200)

  const waiting = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
    undo: boolean
  }
  expect(waiting.undo).toBe(true)
  expect(waiting.summary.fresh).toBe(1)

  const undone = await call(app, '/api/review/undo', 'POST')
  expect(undone.status).toBe(200)
  const card = ((await undone.json()) as { card: ReviewCard }).card
  // It was a new card, so it is new again rather than scheduled.
  expect(card).toMatchObject({
    fresh: true,
    intervalDays: 0,
    ease: 0,
    lapses: 0,
    lastResult: '',
    reviewedAt: 0,
  })
  expect(card.dueDate).toBe(new Date().toISOString().slice(0, 10))

  const after = (await (await call(app, '/api/review')).json()) as {
    cards: ReviewCard[]
    summary: ReviewSummary
    undo: boolean
  }
  expect(after.summary).toMatchObject({ due: 0, fresh: 2, total: 2 })
  expect(after.undo).toBe(false)

  // The answer left the record, so the streak and the counts lost it too.
  const data = (await (await call(app, '/api/data')).json()) as WorkspaceData
  expect(data.reviewStats).toMatchObject({
    streak: 0,
    answeredToday: 0,
    answers: 0,
    total: 0,
  })

  // There is only ever one step back.
  expect((await call(app, '/api/review/undo', 'POST')).status).toBe(409)
})

test('undo puts a card back on the day, ease and misses it had', async () => {
  const { db, app, owner, note } = await withDeck()
  const key = cardKey('What is light?')

  const first = await gradeCard(db, owner, note.id, key, 'good', '2026-11-24')
  expect(first.ok).toBe(true)
  const second = await gradeCard(db, owner, note.id, key, 'hard', '2026-11-26')
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.card).toMatchObject({ dueDate: '2026-11-27', ease: 235 })

  const undone = await undoLastReview(db, owner, '2026-11-26')
  expect(undone.ok).toBe(true)
  if (!undone.ok) return
  expect(undone.card).toMatchObject({
    dueDate: '2026-11-25',
    intervalDays: 1,
    ease: 250,
    lapses: 0,
    lastResult: 'good',
    fresh: false,
  })
  // The first answer is still in the history; only the second went.
  expect((await reviewStats(db, owner, '2026-11-26')).total).toBe(1)

  // An answer that is no longer the last one cannot be taken back.
  await gradeCard(db, owner, note.id, key, 'easy', '2026-11-26')
  await db
    .prepare(
      'INSERT INTO review_log (owner_sub, note_id, card_key, result, day, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(owner, note.id, key, 'good', '2026-11-26', Date.now() + 5_000)
    .run()
  const stale = await undoLastReview(db, owner, '2026-11-26')
  expect(stale.ok).toBe(false)
  if (!stale.ok) expect(stale.reason).toBe('stale')
})

test('the undo button only follows the deck on screen', async () => {
  const { app, note } = await withDeck()
  const other = (await (
    await call(app, '/api/notes', 'POST', {
      subjectId: null,
      title: 'Flashcards · Sound',
      body: ['Q: How does sound travel?', 'A: As a wave through a medium.'].join('\n'),
    })
  ).json()) as { note: { id: string } }

  await call(app, '/api/review', 'POST', {
    noteId: note.id,
    cardKey: cardKey('What is light?'),
    result: 'good',
  })

  const same = (await (
    await call(app, `/api/review?deck=${note.id}`)
  ).json()) as { undo: boolean }
  const elsewhere = (await (
    await call(app, `/api/review?deck=${other.note.id}`)
  ).json()) as { undo: boolean }
  expect(same.undo).toBe(true)
  expect(elsewhere.undo).toBe(false)
})
