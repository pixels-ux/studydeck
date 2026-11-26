import { cardKey, parseCards, revisionKindOf } from '../shared/revision.ts'
import { addDays, nextReview, REVIEW_RESULTS } from '../shared/review.ts'
import type {
  ReviewCard,
  ReviewDeck,
  ReviewResult,
  ReviewStats,
  ReviewSummary,
} from '../shared/types.ts'
import type { SqlDatabase } from './sql.ts'

type CardNoteRow = {
  id: string
  subject_id: string | null
  title: string
  body: string
}

export type ReviewRow = {
  note_id: string
  card_key: string
  due_date: string
  interval_days: number
  ease: number
  lapses: number
  last_result: string
  reviewed_at: number
}

const cardNotes = (db: SqlDatabase, owner: string) =>
  db
    .prepare(
      `SELECT id, subject_id, title, body FROM study_notes
       WHERE owner_sub = ? AND title LIKE 'Flashcards ·%'
       ORDER BY updated_at DESC`,
    )
    .bind(owner)
    .all<CardNoteRow>()

const cardStates = (db: SqlDatabase, owner: string) =>
  db
    .prepare(
      `SELECT note_id, card_key, due_date, interval_days, ease, lapses, last_result, reviewed_at
       FROM card_reviews WHERE owner_sub = ?`,
    )
    .bind(owner)
    .all<ReviewRow>()

function asResult(value: string): ReviewResult | '' {
  return REVIEW_RESULTS.includes(value as ReviewResult)
    ? (value as ReviewResult)
    : ''
}

type ScannedCard = {
  noteId: string
  noteTitle: string
  subjectId: string | null
  key: string
  question: string
  answer: string
  /** The saved schedule for this card, or null when it was never answered. */
  state: ReviewRow | null
}

type ScannedDeck = {
  noteId: string
  noteTitle: string
  subjectId: string | null
  /** The deck's distinct cards, in the order the deck lists them. */
  cards: ScannedCard[]
}

/**
 * Every deck and its cards, read in one pass. Both the queue and the All decks
 * view count from this, so the two can never disagree about a deck.
 */
async function scanDecks(db: SqlDatabase, owner: string): Promise<ScannedDeck[]> {
  const [notes, states] = await Promise.all([
    cardNotes(db, owner),
    cardStates(db, owner),
  ])

  const known = new Map<string, ReviewRow>()
  for (const row of states.results)
    known.set(`${row.note_id}::${row.card_key}`, row)

  const decks: ScannedDeck[] = []
  for (const note of notes.results) {
    if (revisionKindOf(note.title) !== 'cards') continue
    const seen = new Set<string>()
    const cards: ScannedCard[] = []
    for (const card of parseCards(note.body)) {
      const key = cardKey(card.question)
      if (seen.has(key)) continue
      seen.add(key)
      cards.push({
        noteId: note.id,
        noteTitle: note.title,
        subjectId: note.subject_id,
        key,
        question: card.question,
        answer: card.answer,
        state: known.get(`${note.id}::${key}`) ?? null,
      })
    }
    // A deck with no readable cards feeds nothing into the queue.
    if (!cards.length) continue
    decks.push({
      noteId: note.id,
      noteTitle: note.title,
      subjectId: note.subject_id,
      cards,
    })
  }
  return decks
}

type DeckCounts = {
  /** Answered cards whose due date has arrived. */
  due: ReviewCard[]
  /** Cards never answered, which the queue hands out as due. */
  fresh: ReviewCard[]
  /** Every distinct card in the deck. */
  total: number
  /** The first future day one of its cards comes back, or "". */
  nextDue: string
}

/** Splits one deck's cards the way the daily queue does. */
function deckCounts(deck: ScannedDeck, today: string): DeckCounts {
  const due: ReviewCard[] = []
  const fresh: ReviewCard[] = []
  let nextDue = ''

  for (const card of deck.cards) {
    const base = {
      noteId: card.noteId,
      noteTitle: card.noteTitle,
      subjectId: card.subjectId,
      key: card.key,
      question: card.question,
      answer: card.answer,
    }
    const state = card.state
    if (!state) {
      fresh.push({
        ...base,
        dueDate: today,
        intervalDays: 0,
        ease: 0,
        lapses: 0,
        lastResult: '',
        reviewedAt: 0,
        fresh: true,
      })
      continue
    }
    if (state.due_date <= today) {
      due.push({
        ...base,
        dueDate: state.due_date,
        intervalDays: state.interval_days,
        ease: state.ease,
        lapses: state.lapses,
        lastResult: asResult(state.last_result),
        reviewedAt: state.reviewed_at,
        fresh: false,
      })
    } else if (!nextDue || state.due_date < nextDue) {
      nextDue = state.due_date
    }
  }

  return { due, fresh, total: deck.cards.length, nextDue }
}

/**
 * Every card in the notebook's decks, split into what is due today and what is
 * new. Whole days only: a card answered "again" is due tomorrow, which keeps
 * the day's queue finite. An optional deck narrows the queue to that one deck.
 */
export async function reviewQueue(
  db: SqlDatabase,
  owner: string,
  today: string,
  limit = 40,
  noteId?: string,
): Promise<{ cards: ReviewCard[]; summary: ReviewSummary }> {
  const decks = (await scanDecks(db, owner)).filter(
    (deck) => !noteId || deck.noteId === noteId,
  )

  const due: ReviewCard[] = []
  const fresh: ReviewCard[] = []
  let total = 0
  let nextDue = ''

  for (const deck of decks) {
    const counts = deckCounts(deck, today)
    due.push(...counts.due)
    fresh.push(...counts.fresh)
    total += counts.total
    if (counts.nextDue && (!nextDue || counts.nextDue < nextDue))
      nextDue = counts.nextDue
  }

  // Cards due longest come first; a brand new deck follows in its own order.
  due.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.ease - b.ease)
  fresh.sort(
    (a, b) =>
      a.noteTitle.localeCompare(b.noteTitle) ||
      a.question.localeCompare(b.question),
  )

  return {
    cards: [...due, ...fresh].slice(0, limit),
    summary: {
      due: due.length,
      fresh: fresh.length,
      total,
      nextDue,
    },
  }
}

/**
 * Every deck with the counts the daily queue is drawn from: the cards waiting,
 * the cards still new, and the whole deck. The decks with the most to hand out
 * come first, so the queue's source is visible at a glance.
 */
export async function reviewDecks(
  db: SqlDatabase,
  owner: string,
  today: string,
): Promise<ReviewDeck[]> {
  const decks = (await scanDecks(db, owner)).map((deck) => {
    const counts = deckCounts(deck, today)
    return {
      noteId: deck.noteId,
      noteTitle: deck.noteTitle,
      subjectId: deck.subjectId,
      due: counts.due.length,
      fresh: counts.fresh.length,
      total: counts.total,
      nextDue: counts.nextDue,
    }
  })

  decks.sort(
    (a, b) =>
      b.due + b.fresh - (a.due + a.fresh) ||
      b.total - a.total ||
      a.noteTitle.localeCompare(b.noteTitle),
  )
  return decks
}

/**
 * The record the answers add up to: a streak of days, the best run, the answer
 * share over the last month, and the days in it that went unanswered.
 */
export async function reviewStats(
  db: SqlDatabase,
  owner: string,
  today: string,
): Promise<ReviewStats> {
  const rows = await db
    .prepare(
      `SELECT day, result, COUNT(*) AS answers FROM review_log
       WHERE owner_sub = ? GROUP BY day, result`,
    )
    .bind(owner)
    .all<{ day: string; result: string; answers: number }>()

  const byDay = new Map<string, { answers: number; recalled: number }>()
  let total = 0
  for (const row of rows.results) {
    total += row.answers
    const day = byDay.get(row.day) ?? { answers: 0, recalled: 0 }
    day.answers += row.answers
    if (row.result === 'good' || row.result === 'easy') day.recalled += row.answers
    byDay.set(row.day, day)
  }

  const answered = new Set(byDay.keys())

  // A streak is alive until the day is over, so an unanswered today does not
  // break yesterday's run.
  let streak = 0
  let cursor = answered.has(today) ? today : addDays(today, -1)
  while (answered.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }

  const days = [...answered].sort()
  let bestStreak = 0
  let run = 0
  let previous = ''
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1
    bestStreak = Math.max(bestStreak, run)
    previous = day
  }

  // The last 30 days, counted from the first answer so a new student is not
  // told they missed a month before they started. Today is not missed yet.
  const start = addDays(today, -29)
  let answers = 0
  let recalled = 0
  let missedDays = 0
  for (const [day, counts] of byDay) {
    if (day < start || day > today) continue
    answers += counts.answers
    recalled += counts.recalled
  }
  if (days.length) {
    const first = days[0]!
    const from = first > start ? first : start
    for (let day = addDays(today, -1); day >= from; day = addDays(day, -1)) {
      if (!answered.has(day)) missedDays += 1
    }
  }

  return {
    streak,
    bestStreak,
    missedDays,
    answeredToday: byDay.get(today)?.answers ?? 0,
    recalled: answers ? Math.round((recalled / answers) * 100) : 0,
    answers,
    total,
  }
}

export type GradeResult =
  | { ok: true; card: ReviewCard }
  | { ok: false; reason: 'note' | 'card' }

/** Stores one answer and returns the card with its new due date. */
export async function gradeCard(
  db: SqlDatabase,
  owner: string,
  noteId: string,
  key: string,
  result: ReviewResult,
  today: string,
): Promise<GradeResult> {
  const note = await db
    .prepare(
      'SELECT id, subject_id, title, body FROM study_notes WHERE id = ? AND owner_sub = ?',
    )
    .bind(noteId, owner)
    .first<CardNoteRow>()
  if (!note || revisionKindOf(note.title) !== 'cards')
    return { ok: false, reason: 'note' }

  const card = parseCards(note.body).find(
    (item) => cardKey(item.question) === key,
  )
  if (!card) return { ok: false, reason: 'card' }

  const previous = await db
    .prepare(
      `SELECT note_id, card_key, due_date, interval_days, ease, lapses, last_result, reviewed_at
       FROM card_reviews WHERE owner_sub = ? AND note_id = ? AND card_key = ?`,
    )
    .bind(owner, noteId, key)
    .first<ReviewRow>()

  const next = nextReview(
    previous
      ? {
          intervalDays: previous.interval_days,
          ease: previous.ease,
          lapses: previous.lapses,
        }
      : null,
    result,
    today,
  )
  const reviewedAt = Date.now()

  await db.batch([
    db
      .prepare(
        `INSERT INTO card_reviews (owner_sub, note_id, card_key, due_date, interval_days, ease, lapses, last_result, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_sub, note_id, card_key) DO UPDATE SET
           due_date = excluded.due_date,
           interval_days = excluded.interval_days,
           ease = excluded.ease,
           lapses = excluded.lapses,
           last_result = excluded.last_result,
           reviewed_at = excluded.reviewed_at`,
      )
      .bind(
        owner,
        noteId,
        key,
        next.dueDate,
        next.intervalDays,
        next.ease,
        next.lapses,
        result,
        reviewedAt,
      ),
    // Every answer is kept, because the streak and the recall share are read
    // from the history rather than from the card's latest state.
    db
      .prepare(
        'INSERT INTO review_log (owner_sub, note_id, card_key, result, day, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(owner, noteId, key, result, today, reviewedAt),
  ])

  return {
    ok: true,
    card: {
      noteId,
      noteTitle: note.title,
      subjectId: note.subject_id,
      key,
      question: card.question,
      answer: card.answer,
      dueDate: next.dueDate,
      intervalDays: next.intervalDays,
      ease: next.ease,
      lapses: next.lapses,
      lastResult: result,
      reviewedAt,
      fresh: false,
    },
  }
}
