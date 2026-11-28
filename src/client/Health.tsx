import { useMemo } from 'react'
import { daysBetween, fmtDate, todayISO } from './dates'
import { healthNote, subjectHealth, type HealthStatus } from './subjectHealth'
import type { Tab } from './Shell'
import { useWorkspace } from './workspace'
import { workloadCheck, type WorkloadVerdict } from './workload'

const STATUS: Record<HealthStatus, string> = {
  behind: 'Behind',
  watch: 'Watch',
  steady: 'On pace',
  clear: 'Clear',
}

const WORKLOAD: Record<
  WorkloadVerdict,
  { label: string; chip: HealthStatus }
> = {
  clear: { label: 'Nothing left', chip: 'clear' },
  fits: { label: 'Fits', chip: 'steady' },
  tight: { label: 'Tight', chip: 'watch' },
  over: { label: 'Does not fit', chip: 'behind' },
}

/** Hours of study to the tenth, so a weekly figure is not rounded into a lie. */
const hoursLabel = (minutes: number) =>
  `${Math.round((minutes / 60) * 10) / 10} h`

const weeksLabel = (weeks: number) =>
  weeks < 1 ? 'under a week' : weeks === 1 ? '1 week' : `${weeks} weeks`

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
        mistakes: data.mistakes,
      }),
    [data.subjects, data.syllabus, data.tasks, data.mistakes, classLevel, today],
  )

  const behind = rows.filter((row) => row.status === 'behind')
  const chaptersLeft = rows.reduce((sum, row) => sum + row.chaptersLeft, 0)
  const overdueOpen = data.tasks.filter(
    (task) => !task.done && task.dueDate && task.dueDate < today,
  )
  const looseOverdue = overdueOpen.filter((task) => !task.subjectId).length
  const looseMistakes = data.mistakes
    .filter((row) => !row.subjectId)
    .reduce((sum, row) => sum + row.cards, 0)
  const untracked = rows.filter((row) => !row.chaptersTotal)
  const nextExam = data.subjects
    .filter((subject) => subject.examDate && subject.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0]

  // The hours set in class setup, read the same way the revision plan reads them.
  const studyHours = data.profile?.studyHours ?? 3
  const workload = useMemo(
    () => workloadCheck({ health: rows, studyHours }),
    [rows, studyHours],
  )
  const workloadStatus = WORKLOAD[workload.verdict]

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
          {focus ? (
            <>
              This subject is furthest behind: {healthNote(focus)}.
              {then ? ` After that, ${then.subject.name}.` : ''}
            </>
          ) : (
            'Every subject is either fully ticked or has nothing late. Use tonight for review, or tick off the next chapter early.'
          )}
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
          <strong>{overdueOpen.length}</strong>
          <span>{overdueOpen.length === 1 ? 'overdue task' : 'overdue tasks'}</span>
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
          <h3>Does the workload fit?</h3>
          <span className={`health-chip is-${workloadStatus.chip}`}>
            {workloadStatus.label}
          </span>
        </div>
        <p className="muted">
          {workload.chaptersLeft
            ? `${workload.chaptersLeft} chapter${workload.chaptersLeft === 1 ? '' : 's'} left across your subjects, about ${hoursLabel(workload.hoursToCover * 60)} of study at an hour a chapter.`
            : 'Every chapter is ticked off, so there is nothing left to fit before exam week.'}
        </p>
        {workload.chaptersLeft ? (
          <>
            <div className="stats">
              <div className="stat">
                <strong>{hoursLabel(workload.weeklyMinutes)}</strong>
                <span>a week at {studyHours}h a day</span>
              </div>
              <div className="stat">
                <strong>{hoursLabel(workload.neededWeeklyMinutes)}</strong>
                <span>needed a week to finish</span>
              </div>
              <div className="stat">
                <strong>{hoursLabel(Math.abs(workload.gapHours) * 60)}</strong>
                <span>
                  {workload.gapHours >= 0 ? 'spare each week' : 'short each week'}
                </span>
              </div>
            </div>
            <p className="muted">
              {workload.verdict === 'over'
                ? 'The chapters left need more than the hours you set. Add study time, or decide now which chapters to skip.'
                : workload.verdict === 'tight'
                  ? 'This only just fits, so one missed evening will put a subject behind.'
                  : 'This fits inside the hours you set, with room for a missed day.'}
              {workload.tightest
                ? ` The first to slip is ${workload.tightest.name}: ${workload.tightest.chaptersLeft} chapter${workload.tightest.chaptersLeft === 1 ? '' : 's'} to finish in ${weeksLabel(workload.tightest.weeks)}, about ${hoursLabel(workload.tightest.weeklyMinutes)} a week on its own.`
                : ''}
            </p>
            <p className="fineprint">
              {workload.firstExamDate
                ? `Measured against each subject\u2019s own exam date, the first on ${fmtDate(workload.firstExamDate)}.`
                : 'No exam dates yet, so this is measured over the next eight weeks.'}
            </p>
          </>
        ) : null}
      </section>

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
        {looseMistakes ? (
          <p className="fineprint">
            {looseMistakes} missed card{looseMistakes === 1 ? '' : 's'} without a
            subject {looseMistakes === 1 ? 'is' : 'are'} counted in Review but
            cannot lift a subject. Give the deck a subject in Notes to have it
            count here.
          </p>
        ) : null}
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
