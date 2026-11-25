import { useCallback, useEffect, useState } from 'react'
import { nextGap } from '../shared/review'
import type { ReviewCard, ReviewResult, ReviewSummary } from '../shared/types'
import { api } from './api'
import { fmtDate } from './dates'
import type { Tab } from './Shell'
import { useWorkspace } from './workspace'

type Queue = { cards: ReviewCard[]; summary: ReviewSummary }

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
  const [reviewed, setReviewed] = useState(0)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await api<Queue>('/api/review')
      setQueue(next)
      setIndex(0)
      setRevealed(false)
      setReviewed(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open today’s cards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
        setReviewed((count) => count + 1)
        setRevealed(false)
        if (index + 1 >= cards.length) await refresh()
        setIndex(index + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that answer.')
      } finally {
        setBusy(false)
      }
    },
    [busy, cards, index, refresh],
  )

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

  if (loading && !queue) {
    return (
      <section className="card">
        <p className="empty-line">Opening today’s cards…</p>
      </section>
    )
  }

  if (error && !queue) {
    return (
      <section className="card">
        <p className="error small">{error}</p>
        <div className="form-actions">
          <button className="btn primary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  if (!queue) return null

  if (queue.summary.total === 0) {
    return (
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
    )
  }

  if (finished) {
    return (
      <section className="card review-empty">
        <p className="eyebrow">All caught up</p>
        <h3>
          {reviewed === 1
            ? 'You reviewed one card today'
            : `You reviewed ${reviewed} cards today`}
        </h3>
        <p className="muted">
          {reviewed === 0
            ? 'Nothing was due. New cards appear here the day after you make a deck.'
            : queue.summary.nextDue
              ? `The next cards come back on ${fmtDate(queue.summary.nextDue)}.`
              : 'Every card is scheduled. Studydeck will bring them back when they are due.'}
        </p>
        <div className="form-actions">
          <button className="btn primary" onClick={() => onNavigate('today')}>
            Back to Today
          </button>
          <button className="btn ghost" onClick={() => void load()}>
            Check the queue again
          </button>
        </div>
      </section>
    )
  }

  if (!card) return null
  const memory = card.fresh
    ? null
    : { intervalDays: card.intervalDays, ease: card.ease, lapses: card.lapses }

  return (
    <div className="stack">
      <section className="card review-head">
        <div>
          <p className="eyebrow">{subjectName(card.subjectId)}</p>
          <h3>{card.noteTitle.replace(/^Flashcards · /, '')}</h3>
        </div>
        <div className="review-stats">
          <span>
            <strong>{index + 1}</strong> of {cards.length} today
          </span>
          <span>
            <strong>{cards.length - index}</strong> left today
          </span>
          <span>
            <strong>{queue.summary.total}</strong> in the deck
          </span>
        </div>
      </section>

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
              saved for the next day it is due.
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
