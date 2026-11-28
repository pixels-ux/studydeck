import { useMemo } from 'react'
import { daysBetween, todayISO } from './dates'
import { healthNote, subjectHealth, type HealthStatus } from './subjectHealth'
import type { Tab } from './Shell'
import { useWorkspace } from './workspace'

const STATUS: Record<HealthStatus, string> = {
  behind: 'Behind',
  watch: 'Watch',
  steady: 'On pace',
  clear: 'Clear',
}

export default function Health({
  onNavigate,
}: {
  onNavigate: (tab: Tab) => void
}) {
  const { data } = useWorkspace()
  const today = todayISO()
  const classLevel = data.profile?.classLevel ?? 10

  const rows = useMemo(
    () =>
      subjectHealth({
        subjects: data.subjects,
        syllabus: data.syllabus,
        tasks: data.tasks,
        classLevel,
        today,
      }),
    [data.subjects, data.syllabus, data.tasks, classLevel, today],
  )

  const behind = rows.filter((row) => row.status === 'behind')
  const chaptersLeft = rows.reduce((sum, row) => sum + row.chaptersLeft, 0)
  const overdueTasks = data.tasks.filter(
    (task) => !task.done && task.dueDate && task.dueDate < today,
  )
  const looseOverdue = overdueTasks.filter((task) => !task.subjectId).length
  const untracked = rows.filter((row) => !row.chaptersTotal)
  const nextExam = data.subjects
    .filter((subject) => subject.examDate && subject.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0]

  const waiting = rows.filter((row) => row.status !== 'clear')
  const focus = waiting[0] ?? null
  const then = waiting[1] ?? null

  if (!rows.length) {
    return (
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h3>Subject health</h3>
          </div>
          <p className="empty-line">
            Add your subjects in Class setup and this page will rank them by what
            is behind.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="stack">
      <section className="card health-lead">
        <p className="eyebrow">Where tonight’s study should go</p>
        <h3>
          {focus ? `Start with ${focus.subject.name}` : 'Nothing is behind'}
          {focus ? (
            <span className={`health-chip is-${focus.status}`}>
              {STATUS[focus.status]}
            </span>
          ) : null}
        </h3>
        <p className="muted">
          {focus
            ? `This subject is furthest behind: ${healthNote(focus)}.${
                then ? ` After that, ${then.subject.name}.` : ''
              }`
            : 'Every subject is either fully ticked or has nothing late. Use tonight for review, or tick off the next chapter early.'}
        </p>
        <div className="form-actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => onNavigate('syllabus')}
          >
            {focus && focus.chaptersLeft ? 'Tick off a chapter' : 'Open syllabus'}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => onNavigate('work')}
          >
            Clear overdue work
          </button>
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <strong>{behind.length}</strong>
          <span>{behind.length === 1 ? 'subject behind' : 'subjects behind'}</span>
        </div>
        <div className="stat">
          <strong>{chaptersLeft}</strong>
          <span>chapters left</span>
        </div>
        <div className="stat">
          <strong>{overdueTasks.length}</strong>
          <span>{overdueTasks.length === 1 ? 'overdue task' : 'overdue tasks'}</span>
        </div>
        <div className="stat">
          <strong>
            {nextExam ? daysBetween(today, nextExam.examDate) : '-'}
          </strong>
          <span>{nextExam ? `days to ${nextExam.name}` : 'no exams set'}</span>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Subjects, furthest behind first</h3>
          <span className="count">
            {rows.length} subject{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <ul className="health-rows">
          {rows.map((row) => {
            const percent = row.chaptersTotal
              ? Math.round((row.chaptersDone / row.chaptersTotal) * 100)
              : 0
            return (
              <li key={row.subject.id} className="health-row">
                <span
                  className="subject-dot"
                  style={{ background: row.subject.color }}
                />
                <div className="health-main">
                  <div className="health-head">
                    <strong>{row.subject.name}</strong>
                    <span className={`health-chip is-${row.status}`}>
                      {STATUS[row.status]}
                    </span>
                  </div>
                  <span className="health-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${percent}%`,
                        background: row.subject.color,
                      }}
                    />
                  </span>
                  <span className="health-note">{healthNote(row)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        {looseOverdue ? (
          <p className="fineprint">
            {looseOverdue} overdue task{looseOverdue === 1 ? '' : 's'} without a
            subject {looseOverdue === 1 ? 'is' : 'are'} counted in the total but
            cannot lift a subject. Give a task a subject when you add it to have
            it counted here.
          </p>
        ) : null}
        {untracked.length ? (
          <p className="fineprint">
            No NCERT chapter list for{' '}
            {untracked.map((row) => row.subject.name).join(', ')}: those subjects
            are counted by their overdue work and exam date only.
          </p>
        ) : null}
      </section>
    </div>
  )
}
