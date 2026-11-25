import { useEffect } from 'react'
import { unitsFor } from '../shared/curriculum'
import { fmtDate } from './dates'
import { useWorkspace } from './workspace'

export default function Syllabus({
  focus,
  onFocused,
}: {
  focus?: { subjectId: string; chapter: string } | null
  onFocused?: () => void
}) {
  const { data, toggleChapter } = useWorkspace()
  const classLevel = data.profile?.classLevel ?? 10
  const covered = new Set(data.syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`))

  const rows = data.subjects.map((subject) => {
    const chapters = unitsFor(classLevel, subject.name)
    const done = chapters.filter((chapter) =>
      covered.has(`${subject.id}::${chapter}`),
    ).length
    return { subject, chapters, done }
  })
  const tracked = rows.filter((row) => row.chapters.length > 0)
  const untracked = rows.filter((row) => row.chapters.length === 0)
  const totalChapters = tracked.reduce((sum, row) => sum + row.chapters.length, 0)
  const totalDone = tracked.reduce((sum, row) => sum + row.done, 0)
  const percent = totalChapters ? Math.round((totalDone / totalChapters) * 100) : 0

  // A chapter searched for in the command box is scrolled into view.
  useEffect(() => {
    if (!focus) return
    const row = rows.find((item) => item.subject.id === focus.subjectId)
    const position = row ? row.chapters.indexOf(focus.chapter) : -1
    const target =
      position >= 0
        ? document.getElementById(`chapter-${focus.subjectId}-${position}`)
        : document.getElementById(`subject-${focus.subjectId}`)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    onFocused?.()
  }, [focus])

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>NCERT chapters covered</h3>
          <span className="count">
            {totalDone} of {totalChapters}
          </span>
        </div>
        <p className="muted">
          Tick a chapter once you have revised it. Today shows what is left
          before each exam.
        </p>
        <div className="progress" role="img" aria-label={`${percent}% of chapters ticked`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="fineprint">
          {totalChapters
            ? `${percent}% of your Class ${classLevel} chapters are ticked.`
            : `Studydeck has no chapter list for these subjects yet. Add a subject named like a CBSE subject, such as Mathematics or Science.`}
        </p>
      </section>

      {tracked.map(({ subject, chapters, done }) => {
        const subjectPercent = Math.round((done / chapters.length) * 100)
        return (
          <section className="card" key={subject.id} id={`subject-${subject.id}`}>
            <div className="card-head">
              <h3>
                <span
                  className="subject-dot"
                  style={{ background: subject.color }}
                />
                {subject.name}
              </h3>
              <span className="count">
                {done} of {chapters.length}
                {subject.examDate ? ` · exam ${fmtDate(subject.examDate)}` : ''}
              </span>
            </div>
            <div className="progress">
              <span style={{ width: `${subjectPercent}%`, background: subject.color }} />
            </div>
            <ul className="chapter-list">
              {chapters.map((chapter, position) => {
                const isDone = covered.has(`${subject.id}::${chapter}`)
                return (
                  <li key={chapter}>
                    <label
                      id={`chapter-${subject.id}-${position}`}
                      className={isDone ? 'chapter on' : 'chapter'}
                    >
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => void toggleChapter(subject.id, chapter, !isDone)}
                      />
                      <span>{chapter}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {untracked.length ? (
        <p className="fineprint">
          No NCERT chapter list for{' '}
          {untracked.map((row) => row.subject.name).join(', ')}: those subjects
          are still on your timetable, just without a chapter checklist.
        </p>
      ) : null}
    </div>
  )
}
