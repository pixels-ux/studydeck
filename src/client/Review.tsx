import { useCallback, useEffect, useState } from 'react'
import { nextGap } from '../shared/review'
import type {
  ReviewCard,
  ReviewDeck,
  ReviewResult,
  ReviewStats,
  ReviewSummary,
} from '../shared/types'
import { api } from './api'
import { fmtDate } from './dates'
import type { Tab } from './Shell'
import { useWorkspace } from './workspace'

type Queue = { cards: ReviewCard[]; summary: ReviewSummary; undo?: boolean }
type Mistakes = { cards: ReviewCard[]; total: number }

/** How many missed cards one practice session hands out. */
const PRACTICE = 20

/** The streak and recall record the answers add up to. */
function ReviewRecord({ stats }: { stats: ReviewStats }) {
  return (
    <div className="review-record" aria-label="Your review record">
      <span>
        {stats.streak > 0 ? (
          <>
            <strong>{stats.streak}</strong>{' '}
            {stats.streak === 1 ? 'day in a row' : 'days in a row'}
          </>
        ) : (
          'no streak yet'
        )}
      </span>
      <span>
        <strong>{stats.bestStreak}</strong> best run
      </span>
      <span>
        <strong>{stats.answeredToday}</strong> answered today
      </span>
      <span title="Cards recalled (Good or Easy) in the last 30 days">
        <strong>{stats.recalled}%</strong> recalled in 30 days
      </span>
      <span title="Days in the last 30 with no answers, after your first review">
        <strong>{stats.missedDays}</strong> days missed
      </span>
    </div>
  )
}

const GRADES: {
  result: ReviewResult
  label: string
  tone: string
  key: string
}[] = [
  { result: 'again', label: 'Again', tone: 'again', key: '1' },
  { result: 'hard', label: 'Hard', tone: 'hard', key: '2' },
  { result: 'good', label: 'Good', tone: 'good', key: '3' },
  { result: 'easy', label: 'Easy', tone: 'easy', key: '4' },
]

/**
 * Today's flashcards. The Library already writes the decks; this screen only
 * asks how well you knew each card and stores the next date.
 */
export default function Review({
  onNavigate,
}: {
  onNavigate: (tab: Tab) => void
}) {
  const { data, refresh } = useWorkspace()
  const [queue, setQueue] = useState<Queue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'today' | 'decks' | 'mistakes'>('today')
  const [deckId, setDeckId] = useState<string | null>(null)
  const [practice, setPractice] = useState(false)
  const [decks, setDecks] = useState<ReviewDeck[] | null>(null)
  const [decksError, setDecksError] = useState('')
  const [mistakes, setMistakes] = useState<Mistakes | null>(null)
  const [mistakesError, setMistakesError] = useState('')
  const [canUndo, setCanUndo] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = practice
        ? '?practice=1'
        : deckId
          ? `?deck=${encodeURIComponent(deckId)}`
          : ''
      const next = await api<Queue>(`/api/review${query}`)
      setQueue(next)
      setCanUndo(next.undo === true)
      setIndex(0)
      setRevealed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open today’s cards.')
    } finally {
      setLoading(false)
    }
  }, [deckId, practice])

  useEffect(() => {
    void load()
  }, [load])

  const loadDecks = useCallback(async () => {
    setDecksError('')
    try {
      const next = await api<{ decks: ReviewDeck[] }>('/api/review/decks')
      setDecks(next.decks)
    } catch (e) {
      setDecksError(e instanceof Error ? e.message : 'Could not read your decks.')
    }
  }, [])

  // Read the decks the first time the view is opened; grading clears them so
  // the counts are fresh the next time it is.
  useEffect(() => {
    if (view === 'decks' && !decks) void loadDecks()
  }, [decks, loadDecks, view])

  const loadMistakes = useCallback(async () => {
    setMistakesError('')
    try {
      setMistakes(await api<Mistakes>('/api/review/mistakes'))
    } catch (e) {
      setMistakes(null)
      setMistakesError(
        e instanceof Error ? e.message : 'Could not read the cards you missed.',
      )
    }
  }, [])

  // Read the missed cards each time the view is opened after an answer.
  useEffect(() => {
    if (view === 'mistakes' && !mistakes) void loadMistakes()
  }, [loadMistakes, mistakes, view])

  const cards = queue?.cards ?? []
  const card = cards[index] ?? null
  const finished = Boolean(queue) && index >= cards.length

  const grade = useCallback(
    async (result: ReviewResult) => {
      const current = cards[index]
      if (!current || busy) return
      setBusy(true)
      setError('')
      try {
        await api<{ card: ReviewCard }>('/api/review', {
          method: 'POST',
          body: { noteId: current.noteId, cardKey: current.key, result },
        })
        setRevealed(false)
        // Keeps the rail badge, the tab title and the record in step.
        void refresh()
        setDecks(null)
        setMistakes(null)
        setCanUndo(true)
        setIndex(index + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that answer.')
      } finally {
        setBusy(false)
      }
    },
    [busy, cards, index, refresh],
  )

  /** Takes the answer just given back, schedule and record included. */
  const undoAnswer = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api<{ card: ReviewCard }>('/api/review/undo', { method: 'POST' })
      setCanUndo(false)
      setDecks(null)
      setMistakes(null)
      void refresh()
      // The card is due again, so the queue is read rather than patched.
      await load()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not take that answer back.',
      )
    } finally {
      setBusy(false)
    }
  }, [busy, load, refresh])

  useEffect(() => {
    if (!card) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, .command-overlay')) return
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!revealed) setRevealed(true)
        return
      }
      if (!revealed) return
      const picked = GRADES.find((item) => item.key === event.key)
      if (picked) {
        event.preventDefault()
        void grade(picked.result)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, grade, revealed])

  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'

  /** Narrow the queue to one deck, so its cards come up on their own. */
  const openDeck = (deck: ReviewDeck) => {
    setDeckId(deck.noteId)
    // Drop the notebook queue so the deck's own batch is fetched cleanly.
    setQueue(null)
    setView('today')
  }

  const backToDecks = () => {
    setDeckId(null)
    setView('decks')
  }

  /** The missed cards, read fresh whenever the view is opened. */
  const openMistakes = () => {
    setPractice(false)
    setDeckId(null)
    setMistakes(null)
    setView('mistakes')
  }

  const practiseMistakes = () => {
    setDeckId(null)
    setQueue(null)
    setPractice(true)
    setView('today')
  }

  const backToMistakes = () => {
    setPractice(false)
    setDeckId(null)
    setQueue(null)
    setMistakes(null)
    setView('mistakes')
  }

  const deckName = deckId
    ? (decks?.find((item) => item.noteId === deckId)?.noteTitle ??
      queue?.cards[0]?.noteTitle ??
      '')
    : ''

  const undoButton = canUndo ? (
    <button
      type="button"
      className="btn ghost small"
      onClick={() => void undoAnswer()}
      disabled={busy}
      title="Put the last card back on the date it had"
    >
      Undo last answer
    </button>
  ) : null

  // Where the daily queue pulls from: the decks, and what each one owes.
  const dueToday = (queue?.summary.due ?? 0) + (queue?.summary.fresh ?? 0)
  const deckDue = (decks ?? []).reduce(
    (sum, deck) => sum + deck.due + deck.fresh,
    0,
  )
  const viewBar = practice ? (
    <div className="week-toolbar">
      <button type="button" className="btn ghost small" onClick={backToMistakes}>
        ← Mistakes
      </button>
      <span className="week-label">
        {queue
          ? `${queue.summary.total} ${
              queue.summary.total === 1 ? 'card' : 'cards'
            } you keep missing · this batch of ${cards.length}`
          : 'Cards you keep missing'}
      </span>
      {undoButton}
    </div>
  ) : deckId ? (
    <div className="week-toolbar">
      <button type="button" className="btn ghost small" onClick={backToDecks}>
        ← All decks
      </button>
      <span className="week-label">
        {deckName ? deckName.replace(/^Flashcards · /, '') : 'This deck'}
        {queue ? ` · ${dueToday} due today` : ''}
      </span>
      {undoButton}
    </div>
  ) : (
    <div className="week-toolbar">
      <div className="segmented" role="group" aria-label="Review view">
        <button
          type="button"
          className={view === 'today' ? 'seg active' : 'seg'}
          onClick={() => setView('today')}
        >
          Today’s cards
        </button>
        <button
          type="button"
          className={view === 'decks' ? 'seg active' : 'seg'}
          onClick={() => setView('decks')}
        >
          All decks
        </button>
        <button
          type="button"
          className={view === 'mistakes' ? 'seg active' : 'seg'}
          onClick={openMistakes}
        >
          Mistakes
        </button>
      </div>
      <span className="week-label">
        {view === 'mistakes'
          ? mistakes
            ? `${mistakes.total} missed ${mistakes.total === 1 ? 'card' : 'cards'}`
            : 'Reading what you missed…'
          : view === 'decks'
            ? decks
              ? `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'} · ${deckDue} due in this notebook`
              : 'Reading your decks…'
            : queue
              ? `${queue.summary.total} ${queue.summary.total === 1 ? 'card' : 'cards'} in all · ${dueToday} due today`
              : ''}
      </span>
      {undoButton}
    </div>
  )

  if (view === 'decks') {
    return (
      <div className="stack">
        {viewBar}
        {decksError ? (
          <section className="card">
            <p className="error small">{decksError}</p>
            <div className="form-actions">
              <button className="btn primary" onClick={() => void loadDecks()}>
                Try again
              </button>
            </div>
          </section>
        ) : !decks ? (
          <section className="card">
            <p className="empty-line">Reading your decks…</p>
          </section>
        ) : decks.length === 0 ? (
          <section className="card review-empty">
            <p className="eyebrow">No decks yet</p>
            <h3>Your decks are waiting to be made</h3>
            <p className="muted">
              In the Library, open a chapter and press <strong>Flashcards</strong> — one
              item or a whole subject. Each deck shows up here with the cards it
              feeds into the daily queue.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={() => onNavigate('library')}>
                Open the Library
              </button>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <h3>Every deck</h3>
              <span className="count">
                {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
              </span>
            </div>
            <p className="muted deck-intro">
              Due today is what the queue can hand out now, and a new card counts
              as due. Open a deck to review just its cards.
            </p>
            <table className="deck-table">
              <thead>
                <tr>
                  <th scope="col">Deck</th>
                  <th scope="col">Due today</th>
                  <th scope="col">Cards</th>
                </tr>
              </thead>
              <tbody>
                {decks.map((deck) => {
                  const waiting = deck.due + deck.fresh
                  return (
                    <tr key={deck.noteId}>
                      <th scope="row">
                        <button
                          type="button"
                          className="deck-open"
                          onClick={() => openDeck(deck)}
                          title={`Review ${deck.noteTitle.replace(/^Flashcards · /, '')}`}
                        >
                          <span className="deck-subject">
                            {subjectName(deck.subjectId)}
                          </span>
                          <span className="deck-title">
                            {deck.noteTitle.replace(/^Flashcards · /, '')}
                          </span>
                          <span className="deck-when">
                            {waiting > 0
                              ? `${deck.fresh} new · ${deck.due} coming back`
                              : deck.nextDue
                                ? `next on ${fmtDate(deck.nextDue)}`
                                : 'nothing scheduled'}
                          </span>
                        </button>
                      </th>
                      <td className={waiting > 0 ? 'deck-count' : 'deck-count quiet'}>
                        {waiting}
                      </td>
                      <td className="deck-count quiet">{deck.total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    )
  }

  if (view === 'mistakes') {
    return (
      <div className="stack">
        {viewBar}
        {mistakesError ? (
          <section className="card">
            <p className="error small">{mistakesError}</p>
            <div className="form-actions">
              <button className="btn primary" onClick={() => void loadMistakes()}>
                Try again
              </button>
            </div>
          </section>
        ) : !mistakes ? (
          <section className="card">
            <p className="empty-line">Reading what you missed…</p>
          </section>
        ) : mistakes.cards.length === 0 ? (
          <section className="card review-empty">
            <p className="eyebrow">Nothing missed</p>
            <h3>No card is coming back wrong</h3>
            <p className="muted">
              A card lands here when your last answer was <strong>Again</strong>.
              Answer a missed card well in a practice session and it leaves the
              list.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={() => onNavigate('today')}>
                Back to Today
              </button>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <h3>Cards you keep missing</h3>
              <span className="count">
                {mistakes.total} {mistakes.total === 1 ? 'card' : 'cards'}
              </span>
            </div>
            <p className="muted deck-intro">
              The cards whose last answer was Again, worst first, from every
              notebook. They are scheduled for later, but practising one now is
              how it stops coming back wrong.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={practiseMistakes}>
                {mistakes.total > PRACTICE
                  ? `Practise the ${PRACTICE} worst`
                  : mistakes.total === 1
                    ? 'Practise this card'
                    : `Practise these ${mistakes.total}`}
              </button>
              <button className="btn ghost" onClick={() => void loadMistakes()}>
                Read the list again
              </button>
            </div>
            <table className="deck-table">
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Missed</th>
                  <th scope="col">Next due</th>
                </tr>
              </thead>
              <tbody>
                {mistakes.cards.map((card) => (
                  <tr key={`${card.noteId}:${card.key}`}>
                    <th scope="row">
                      <span className="deck-subject">
                        {card.notebookName} ·{' '}
                        {card.noteTitle.replace(/^Flashcards · /, '')}
                      </span>
                      <span className="deck-title">{card.question}</span>
                    </th>
                    <td className="deck-count">{card.lapses}×</td>
                    <td className="deck-count quiet">{fmtDate(card.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mistakes.total > mistakes.cards.length ? (
              <p className="fineprint">
                Showing the worst {mistakes.cards.length} of {mistakes.total}.
              </p>
            ) : null}
          </section>
        )}
      </div>
    )
  }

  if (loading && !queue) {
    return (
      <div className="stack">
        {viewBar}
        <section className="card">
          <p className="empty-line">Opening today’s cards…</p>
        </section>
      </div>
    )
  }

  if (error && !queue) {
    return (
      <div className="stack">
        {viewBar}
        <section className="card">
          <p className="error small">{error}</p>
          <div className="form-actions">
            <button className="btn primary" onClick={() => void load()}>
              Try again
            </button>
            {deckId ? (
              <button className="btn ghost" onClick={backToDecks}>
                Back to all decks
              </button>
            ) : null}
          </div>
        </section>
      </div>
    )
  }

  if (!queue) return null

  if (queue.summary.total === 0) {
    if (practice) {
      return (
        <div className="stack">
          {viewBar}
          <section className="card review-empty">
            <p className="eyebrow">Nothing missed</p>
            <h3>No card is waiting from a wrong answer</h3>
            <p className="muted">
              A card lands here when your last answer was Again. Answer one well
              and it leaves the list.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={backToMistakes}>
                Back to mistakes
              </button>
              <button className="btn ghost" onClick={() => onNavigate('today')}>
                Back to Today
              </button>
            </div>
          </section>
        </div>
      )
    }
    if (deckId) {
      return (
        <div className="stack">
          {viewBar}
          <section className="card review-empty">
            <p className="eyebrow">Deck not found</p>
            <h3>That deck is no longer here</h3>
            <p className="muted">
              It may have been deleted or renamed since the list was read. Your other
              decks are still in the book.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={backToDecks}>
                Back to all decks
              </button>
            </div>
          </section>
        </div>
      )
    }
    return (
      <div className="stack">
        {viewBar}
        <section className="card review-empty">
          <p className="eyebrow">Nothing to review yet</p>
          <h3>Your decks are waiting to be made</h3>
          <p className="muted">
            In the Library, open a chapter and press <strong>Flashcards</strong> — one
            item or a whole subject. Studydeck then brings a few back each day until
            they stick.
          </p>
          <div className="form-actions">
            <button className="btn primary" onClick={() => onNavigate('library')}>
              Open the Library
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (finished) {
    if (practice) {
      return (
        <div className="stack">
          {viewBar}
          <section className="card review-empty">
            <p className="eyebrow">Practice done</p>
            <h3>
              {queue.summary.total === cards.length
                ? 'You went through every missed card'
                : `You went through the worst ${cards.length}`}
            </h3>
            <p className="muted">
              A card answered without an Again leaves this list; one answered
              Again stays and comes back tomorrow. The daily queue is waiting
              when you are.
            </p>
            <div className="form-actions">
              <button className="btn primary" onClick={backToMistakes}>
                Back to mistakes
              </button>
              <button className="btn ghost" onClick={() => void load()}>
                Practise what is left
              </button>
            </div>
          </section>
        </div>
      )
    }
    // The server hands out at most forty cards at a time, so a long backlog
    // ends a batch instead of the day.
    const moreDue = Math.max(
      0,
      queue.summary.due + queue.summary.fresh - queue.cards.length,
    )
    return (
      <div className="stack">
        {viewBar}
        <section className="card review-empty">
          <p className="eyebrow">{moreDue > 0 ? 'Batch done' : 'All caught up'}</p>
          <h3>
            {deckId
              ? moreDue > 0
                ? `${moreDue} more from this deck`
                : 'Nothing due in this deck'
              : moreDue > 0
                ? `${moreDue} more ${moreDue === 1 ? 'card' : 'cards'} due today`
                : data.reviewStats.answeredToday === 1
                  ? 'You answered one card today'
                  : `You answered ${data.reviewStats.answeredToday} cards today`}
          </h3>
          <p className="muted">
            {deckId
              ? moreDue > 0
                ? 'The queue is handed out forty cards at a time, so a long backlog does not become one endless sitting. Keep going, or go back to the other decks.'
                : queue.summary.nextDue
                  ? `The next card in this deck comes back on ${fmtDate(queue.summary.nextDue)}.`
                  : 'Every card in this deck is scheduled. Studydeck will bring them back when they are due.'
              : moreDue > 0
                ? 'The queue is handed out forty cards at a time, so a long backlog does not become one endless sitting. Take a break, or keep going.'
                : data.reviewStats.answeredToday === 0
                  ? 'Nothing was due. New cards appear here the day after you make a deck.'
                  : queue.summary.nextDue
                    ? `The next cards come back on ${fmtDate(queue.summary.nextDue)}.`
                    : 'Every card is scheduled. Studydeck will bring them back when they are due.'}
          </p>
          {data.reviewStats.total > 0 ? (
            <>
              <ReviewRecord stats={data.reviewStats} />
              <p className="fineprint">
                Missed days counts the days in the last 30 with no answers, after
                your first review. A streak stays alive until the day is over.
              </p>
            </>
          ) : null}
          <div className="form-actions">
            <button
              className="btn primary"
              onClick={deckId ? backToDecks : () => onNavigate('today')}
            >
              {deckId ? 'Back to all decks' : 'Back to Today'}
            </button>
            <button className="btn ghost" onClick={() => void load()}>
              {moreDue > 0
                ? 'Review the next forty'
                : deckId
                  ? 'Check this deck again'
                  : 'Check the queue again'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (!card) return null
  const memory = card.fresh
    ? null
    : { intervalDays: card.intervalDays, ease: card.ease, lapses: card.lapses }

  return (
    <div className="stack">
      {viewBar}
      <section className="card review-head">
        <div>
          <p className="eyebrow">
            {data.notebooks.length > 1
              ? `${card.notebookName}${
                  card.notebookId === data.notebookId
                    ? ` · ${subjectName(card.subjectId)}`
                    : ''
                }`
              : subjectName(card.subjectId)}
          </p>
          <h3>{card.noteTitle.replace(/^Flashcards · /, '')}</h3>
        </div>
        <div className="review-stats">
          <span>
            <strong>{index + 1}</strong> of {cards.length}{' '}
            {practice ? 'in this batch' : 'today'}
          </span>
          <span>
            <strong>{cards.length - index}</strong> left{' '}
            {practice ? 'in this batch' : 'today'}
          </span>
          <span>
            <strong>{queue.summary.total}</strong>{' '}
            {practice
              ? 'cards you keep missing'
              : deckId
                ? 'in this deck'
                : 'cards in all'}
          </span>
        </div>
      </section>

      {data.reviewStats.total > 0 ? (
        <ReviewRecord stats={data.reviewStats} />
      ) : null}

      <article className="review-card">
        <p className="eyebrow">
          {card.fresh ? 'New card' : 'Coming back'}
          {card.lapses ? ` · missed ${card.lapses}×` : ''}
        </p>
        <h2 className="review-question">{card.question}</h2>
        {revealed ? (
          <>
            <div className="review-answer">
              <p className="eyebrow">Answer</p>
              <p>{card.answer}</p>
            </div>
            <div className="review-grades">
              {GRADES.map((item) => (
                <button
                  key={item.result}
                  type="button"
                  className={`grade grade-${item.tone}`}
                  disabled={busy}
                  onClick={() => void grade(item.result)}
                >
                  <strong>{item.label}</strong>
                  <span>{nextGap(memory, item.result)}</span>
                  <kbd>{item.key}</kbd>
                </button>
              ))}
            </div>
            <p className="fineprint">
              Be honest: a card you had to dig for is not “Good”. Each answer is
              saved for the next day it is due, and Undo last answer above takes
              back a wrong key.
            </p>
          </>
        ) : (
          <div className="review-reveal">
            <button
              className="btn primary"
              onClick={() => setRevealed(true)}
              autoFocus
            >
              Show answer
            </button>
            <p className="fineprint">
              Say the answer out loud, then check it. Space or Enter also works.
            </p>
          </div>
        )}
      </article>

      {error ? <p className="error small">{error}</p> : null}
    </div>
  )
}
