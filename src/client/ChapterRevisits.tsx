import { useMemo, useState } from 'react'
import {
  chapterRevisits,
  REVISIT_AFTER_DAYS,
  type ChapterRevisit,
} from './chapterReview'
import { fmtDate, todayISO } from './dates'
import { useWorkspace } from './workspace'

/** Enough to act on without turning Today into a syllabus page. */
const SHOWN = 6

const keyOf = (item: ChapterRevisit) => `${item.subjectId}::${item.chapter}`

const examText = (days: number | null) =>
  days === null
    ? 'no exam date'
    : days === 0
      ? 'exam today'
      : days === 1
        ? 'exam tomorrow'
        : `exam in ${days} days`

export default function ChapterRevisits() {
  const { data, toggleChapter } = useWorkspace()
  const today = todayISO()
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')

  const due = useMemo(
    () =>
      chapterRevisits({
        subjects: data.subjects,
        syllabus: data.syllabus,
        today,
      }),
    [data.subjects, data.syllabus, today],
  )

  if (!due.length) return null

  async function revisit(item: ChapterRevisit) {
    const key = keyOf(item)
    setBusy(key)
    setError('')
    setFlash('')
    try {
      await toggleChapter(item.subjectId, item.chapter, true)
      setFlash(
        `${item.chapter} is ticked again: it comes back in ${REVISIT_AFTER_DAYS} days.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that revisit.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Chapters to revisit</h3>
        <span className="count">
          {due.length} due
        </span>
      </div>
      <p className="muted">
        Ticked a week ago or more. Ten minutes of recall is enough — answer one
        question from memory, then tick the chapter again to clear it for another
        week.
      </p>
      <ul className="health-rows">
        {due.slice(0, SHOWN).map((item) => {
          const key = keyOf(item)
          return (
            <li key={key} className="health-row">
              <span
                className="subject-dot"
                style={{ background: item.color }}
              />
              <div className="health-main">
                <div className="health-head">
                  <strong>{item.chapter}</strong>
                  <span className="health-chip is-watch">
                    {item.daysSince} days
                  </span>
                </div>
                <span className="health-note">
                  {item.subjectName} · ticked {fmtDate(item.tickedOn)} ·{' '}
                  {examText(item.daysToExam)}
                </span>
              </div>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy === key}
                onClick={() => void revisit(item)}
              >
                {busy === key ? 'Saving…' : 'Ticked again'}
              </button>
            </li>
          )
        })}
      </ul>
      {due.length > SHOWN ? (
        <p className="fineprint">
          The {SHOWN} nearest are listed; {due.length - SHOWN} more wait in
          Syllabus.
        </p>
      ) : null}
      {flash ? <p className="notice">{flash}</p> : null}
      {error ? <p className="error small">{error}</p> : null}
    </section>
  )
}
