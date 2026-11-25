import { cardKey, parseCards, revisionKindOf } from '../shared/revision.ts'
import { nextReview, REVIEW_RESULTS } from '../shared/review.ts'
import type { ReviewCard, ReviewResult, ReviewSummary } from '../shared/types.ts'
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

/**
 * Every card in the notebook's decks, split into what is due today and what is
 * new. Whole days only: a card answered "again" is due tomorrow, which keeps
 * the day's queue finite.
 */
export async function reviewQueue(
  db: SqlDatabase,
  owner: string,
  today: string,
  limit = 40,
): Promise<{ cards: ReviewCard[]; summary: ReviewSummary }> {
  const [notes, states] = await Promise.all([
    cardNotes(db, owner),
    cardStates(db, owner),
  ])

  const known = new Map<string, ReviewRow>()
  for (const row of states.results)
    known.set(`${row.note_id}::${row.card_key}`, row)

  const due: ReviewCard[] = []
  const fresh: ReviewCard[] = []
  let total = 0
  let nextDue = ''

  for (const note of notes.results) {
    if (revisionKindOf(note.title) !== 'cards') continue
    const seen = new Set<string>()
    for (const card of parseCards(note.body)) {
      const key = cardKey(card.question)
      if (seen.has(key)) continue
      seen.add(key)
      total += 1
      const state = known.get(`${note.id}::${key}`)
      const base = {
        noteId: note.id,
        noteTitle: note.title,
        subjectId: note.subject_id,
        key,
        question: card.question,
        answer: card.answer,
      }
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

  await db
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
    )
    .run()

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
