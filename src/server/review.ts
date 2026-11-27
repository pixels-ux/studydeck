import { cardKey, parseCards, revisionKindOf } from '../shared/revision.ts'
import { addDays, nextReview, REVIEW_RESULTS } from '../shared/review.ts'
import type {
  ReviewCard,
  ReviewDeck,
  ReviewResult,
  ReviewStats,
  ReviewSummary,
} from '../shared/types.ts'
import { BASE_OWNER, scopedOwner } from './db.ts'
import type { SqlDatabase } from './sql.ts'

/** A notebook a review queue can draw from. */
export type ReviewBook = { id: string; name: string }

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
  /** The notebook it lives in, so a card in a cross-notebook queue is named. */
  book: ReviewBook
  /** The deck's distinct cards, in the order the deck lists them. */
  cards: ScannedCard[]
}

/**
 * Every deck and its cards, read in one pass. Both the queue and the All decks
 * view count from this, so the two can never disagree about a deck.
 */
async function scanDecks(
  db: SqlDatabase,
  owner: string,
  book: ReviewBook,
): Promise<ScannedDeck[]> {
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
      book,
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
      notebookId: deck.book.id,
      notebookName: deck.book.name,
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
  book: ReviewBook = { id: '', name: '' },
): Promise<{ cards: ReviewCard[]; summary: ReviewSummary }> {
  const decks = (await scanDecks(db, owner, book)).filter(
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
 * Today's queue read across every notebook, so a deck in a book you are not
 * looking at still comes up. Each card names the notebook it lives in, and the
 * order is the same one a single notebook's queue uses.
 */
export async function reviewAcross(
  db: SqlDatabase,
  books: ReviewBook[],
  today: string,
  limit = 40,
  noteId?: string,
): Promise<{ cards: ReviewCard[]; summary: ReviewSummary }> {
  const due: ReviewCard[] = []
  const fresh: ReviewCard[] = []
  let dueCount = 0
  let freshCount = 0
  let total = 0
  let nextDue = ''

  for (const book of books) {
    const queue = await reviewQueue(
      db,
      scopedOwner(book.id),
      today,
      Number.MAX_SAFE_INTEGER,
      noteId,
      book,
    )
    for (const card of queue.cards) (card.fresh ? fresh : due).push(card)
    dueCount += queue.summary.due
    freshCount += queue.summary.fresh
    total += queue.summary.total
    if (queue.summary.nextDue && (!nextDue || queue.summary.nextDue < nextDue))
      nextDue = queue.summary.nextDue
  }

  due.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.ease - b.ease)
  fresh.sort(
    (a, b) =>
      a.notebookName.localeCompare(b.notebookName) ||
      a.noteTitle.localeCompare(b.noteTitle) ||
      a.question.localeCompare(b.question),
  )

  return {
    cards: [...due, ...fresh].slice(0, limit),
    summary: {
      due: dueCount,
      fresh: freshCount,
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
  const decks = (await scanDecks(db, owner, { id: '', name: '' })).map(
    (deck) => {
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
    },
  )

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

/** The notebook a row's owner belongs to, named as the screen should show it. */
async function bookOf(db: SqlDatabase, owner: string): Promise<ReviewBook> {
  // Notebook rows are owned by the whole app, not by one book's scope.
  const id = owner.startsWith(`${BASE_OWNER}:`)
    ? owner.slice(BASE_OWNER.length + 1)
    : ''
  const row = await db
    .prepare('SELECT id, name FROM notebooks WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string }>()
  return row ? { id: row.id, name: row.name } : { id: '', name: '' }
}

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
    // Keep the answer and what the card looked like before it, so the screen
    // can offer one step back instead of a schedule quietly bent by a typo.
    db
      .prepare(
        `INSERT INTO review_undo (owner_sub, note_id, card_key, result, day, reviewed_at,
           had_before, due_date, interval_days, ease, lapses, last_result, prev_reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_sub) DO UPDATE SET
           note_id = excluded.note_id,
           card_key = excluded.card_key,
           result = excluded.result,
           day = excluded.day,
           reviewed_at = excluded.reviewed_at,
           had_before = excluded.had_before,
           due_date = excluded.due_date,
           interval_days = excluded.interval_days,
           ease = excluded.ease,
           lapses = excluded.lapses,
           last_result = excluded.last_result,
           prev_reviewed_at = excluded.prev_reviewed_at`,
      )
      .bind(
        owner,
        noteId,
        key,
        result,
        today,
        reviewedAt,
        previous ? 1 : 0,
        previous?.due_date ?? '',
        previous?.interval_days ?? 0,
        previous?.ease ?? 0,
        previous?.lapses ?? 0,
        previous?.last_result ?? '',
        previous?.reviewed_at ?? 0,
      ),
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

  const book = await bookOf(db, owner)
  return {
    ok: true,
    card: {
      noteId,
      noteTitle: note.title,
      subjectId: note.subject_id,
      notebookId: book.id,
      notebookName: book.name,
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

type UndoRow = {
  note_id: string
  card_key: string
  result: string
  day: string
  reviewed_at: number
  had_before: number
  due_date: string
  interval_days: number
  ease: number
  lapses: number
  last_result: string
  prev_reviewed_at: number
}

/** The saved answer waiting to be taken back, newest across the notebooks. */
async function pendingUndo(
  db: SqlDatabase,
  owners: string[],
): Promise<(UndoRow & { owner_sub: string }) | null> {
  let newest: (UndoRow & { owner_sub: string }) | null = null
  for (const owner of owners) {
    const row = await db
      .prepare(
        `SELECT owner_sub, note_id, card_key, result, day, reviewed_at, had_before,
           due_date, interval_days, ease, lapses, last_result, prev_reviewed_at
         FROM review_undo WHERE owner_sub = ?`,
      )
      .bind(owner)
      .first<UndoRow & { owner_sub: string }>()
    if (row && (!newest || row.reviewed_at > newest.reviewed_at)) newest = row
  }
  return newest
}

/** The newest answer in the history, whichever notebook it was given in. */
async function latestAnswer(db: SqlDatabase, owners: string[]): Promise<number> {
  let latest = 0
  for (const owner of owners) {
    const row = await db
      .prepare('SELECT MAX(reviewed_at) AS latest FROM review_log WHERE owner_sub = ?')
      .bind(owner)
      .first<{ latest: number | null }>()
    latest = Math.max(latest, row?.latest ?? 0)
  }
  return latest
}

/**
 * Whether the screen should offer to take the last answer back: there is a
 * saved answer across the given notebooks, it is still the newest one in their
 * history, and — when a deck is open — it belongs to that deck rather than
 * another one.
 */
async function undoAvailableFor(
  db: SqlDatabase,
  owners: string[],
  noteId?: string,
): Promise<boolean> {
  const undo = await pendingUndo(db, owners)
  if (!undo) return false
  if (noteId && undo.note_id !== noteId) return false
  return (await latestAnswer(db, owners)) === undo.reviewed_at
}

export async function undoAvailable(
  db: SqlDatabase,
  owner: string,
  noteId?: string,
): Promise<boolean> {
  return undoAvailableFor(db, [owner], noteId)
}

/** The same, for a queue that draws cards from every notebook. */
export async function undoAvailableAcross(
  db: SqlDatabase,
  owners: string[],
  noteId?: string,
): Promise<boolean> {
  return undoAvailableFor(db, owners, noteId)
}

export type UndoResult =
  | { ok: true; card: ReviewCard }
  | { ok: false; reason: 'nothing' | 'stale' | 'note' | 'card' }

/** Takes back the answer given last in one notebook. */
export async function undoLastReview(
  db: SqlDatabase,
  owner: string,
  today: string,
): Promise<UndoResult> {
  return undoFor(db, [owner], today)
}

/** Takes back the newest answer across every notebook a queue draws from. */
export async function undoLastReviewAcross(
  db: SqlDatabase,
  owners: string[],
  today: string,
): Promise<UndoResult> {
  return undoFor(db, owners, today)
}

/**
 * Takes back the answer given last: the card returns to the date, ease and
 * misses it had, and the answer leaves the history, so the streak, the recall
 * share and the queue all read as if it never happened.
 */
async function undoFor(
  db: SqlDatabase,
  owners: string[],
  today: string,
): Promise<UndoResult> {
  const undo = await pendingUndo(db, owners)
  if (!undo) return { ok: false, reason: 'nothing' }
  const owner = undo.owner_sub

  const clear = () =>
    db.prepare('DELETE FROM review_undo WHERE owner_sub = ?').bind(owner).run()

  const latest = await latestAnswer(db, owners)
  // Something was answered after this card, so the step back would be a lie.
  if (latest !== undo.reviewed_at) {
    await clear()
    return { ok: false, reason: 'stale' }
  }

  const note = await db
    .prepare(
      'SELECT id, subject_id, title, body FROM study_notes WHERE id = ? AND owner_sub = ?',
    )
    .bind(undo.note_id, owner)
    .first<CardNoteRow>()
  if (!note || revisionKindOf(note.title) !== 'cards') {
    await clear()
    return { ok: false, reason: 'note' }
  }
  const card = parseCards(note.body).find(
    (item) => cardKey(item.question) === undo.card_key,
  )
  if (!card) {
    await clear()
    return { ok: false, reason: 'card' }
  }

  const statements = [
    // One row only: two quick answers can share a millisecond, and taking back
    // the last one must not erase the one before it as well.
    db
      .prepare(
        `DELETE FROM review_log WHERE rowid IN (
           SELECT rowid FROM review_log
           WHERE owner_sub = ? AND note_id = ? AND card_key = ? AND reviewed_at = ?
           ORDER BY rowid DESC LIMIT 1)`,
      )
      .bind(owner, undo.note_id, undo.card_key, undo.reviewed_at),
    db.prepare('DELETE FROM review_undo WHERE owner_sub = ?').bind(owner),
  ]
  if (undo.had_before)
    statements.push(
      db
        .prepare(
          `UPDATE card_reviews SET due_date = ?, interval_days = ?, ease = ?, lapses = ?,
             last_result = ?, reviewed_at = ?
           WHERE owner_sub = ? AND note_id = ? AND card_key = ?`,
        )
        .bind(
          undo.due_date,
          undo.interval_days,
          undo.ease,
          undo.lapses,
          undo.last_result,
          undo.prev_reviewed_at,
          owner,
          undo.note_id,
          undo.card_key,
        ),
    )
  else
    // The card was new, so it becomes new again rather than scheduled.
    statements.push(
      db
        .prepare(
          'DELETE FROM card_reviews WHERE owner_sub = ? AND note_id = ? AND card_key = ?',
        )
        .bind(owner, undo.note_id, undo.card_key),
    )
  await db.batch(statements)

  const before = undo.had_before === 1
  const book = await bookOf(db, owner)
  return {
    ok: true,
    card: {
      noteId: undo.note_id,
      noteTitle: note.title,
      subjectId: note.subject_id,
      notebookId: book.id,
      notebookName: book.name,
      key: undo.card_key,
      question: card.question,
      answer: card.answer,
      dueDate: before ? undo.due_date : today,
      intervalDays: before ? undo.interval_days : 0,
      ease: before ? undo.ease : 0,
      lapses: before ? undo.lapses : 0,
      lastResult: before ? asResult(undo.last_result) : '',
      reviewedAt: before ? undo.prev_reviewed_at : 0,
      fresh: !before,
    },
  }
}

