import { useMemo, useEffect, useState } from 'react'
import { unitsFor } from '../shared/curriculum'
import type { Task } from '../shared/types'
import type { Tab } from './Shell'
import {
  DAY_SHORT,
  daysBetween,
  fmtDate,
  fmtDateLong,
  fmtDuration,
  fmtTime,
  greeting,
  minutesNow,
  todayISO,
  dayIndexOf,
} from './dates'
import ChapterRevisits from './ChapterRevisits'
import DayCheckin from './DayCheckin'
import SessionTimer from './SessionTimer'
import { weekReview } from './weekReview'
import { useWorkspace } from './workspace'
import type { RevisionSheetRow } from './revisionSheet.types'

function taskInput(task: Task, done: boolean) {
  return {
    subjectId: task.subjectId,
    title: task.title,
    dueDate: task.dueDate,
    priority: task.priority,
    details: task.details,
    done,
  }
}

export default function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { data, saveTask } = useWorkspace()
  const today = todayISO()
  const weekday = dayIndexOf(today)
  const now = minutesNow()
  const subject = (id: string | null) => data.subjects.find((item) => item.id === id)

  const classes = data.entries
    .filter(
      (entry) => entry.plan === 'regular' && entry.day === weekday && entry.kind !== 'break',
    )
    .sort((a, b) => a.startMin - b.startMin)
  const nextClass = classes.find((entry) => entry.endMin > now)
  const revision = data.entries
    .filter((entry) => entry.plan === 'intensive' && entry.date === today)
    .sort((a, b) => a.startMin - b.startMin)

  // The last seven finished evenings: what the plan asked for against the
  // check-ins that were actually saved.
  const week = useMemo(
    () =>
      weekReview({
        entries: data.entries,
        logs: data.days,
        subjects: data.subjects,
        today,
      }),
    [data.entries, data.days, data.subjects, today],
  )

  const open = data.tasks.filter((task) => !task.done)
  const dueSoon = open
    .filter(
      (task) => task.dueDate && daysBetween(today, task.dueDate) <= 7,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const overdue = open.filter((task) => task.dueDate && task.dueDate < today).length
  const nextExam = data.subjects
    .filter((item) => item.examDate && item.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0]

  const cardsDue = data.review.due + data.review.fresh
  const classLevel = data.profile?.classLevel ?? 10
  const covered = new Set(
    data.syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`),
  )
  const examRows = data.subjects
    .filter((item) => item.examDate && item.examDate >= today)
    .map((item) => {
      const chapters = unitsFor(classLevel, item.name)
      const done = chapters.filter((chapter) =>
        covered.has(`${item.id}::${chapter}`),
      ).length
      return { subject: item, total: chapters.length, done }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => a.subject.examDate.localeCompare(b.subject.examDate))
    .slice(0, 3)

  const [revisionSheetData, setRevisionSheetData] = useState<{
    rows: RevisionSheetRow[]
    today: string
  }>({ rows: [], today })
  useEffect(() => {
    let active = true
    fetch('/api/revision-sheet')
      .then((r) => r.json())
      .then((body) => {
        if (!active) return
        const rows = (body?.rows ?? []) as RevisionSheetRow[]
        if (rows.length)
          setRevisionSheetData({ rows, today: body?.today ?? today })
      })
      .catch(() => {
        // Leave rows empty when the endpoint is unavailable.
      })
    return () => {
      active = false
    }
  }, [today])

  return (
    <div className="stack">
      <section className="hero-strip">
        <div className="hero-copy">
          <p className="eyebrow">
            {data.profile ? `Class ${data.profile.classLevel} · ` : ''}
            {fmtDateLong(today)}
          </p>
          <h2>{greeting()}. Here’s your day.</h2>
          <p className="muted">
            {nextClass
              ? `${nextClass.title} at ${fmtTime(nextClass.startMin)}${
                  nextClass.room ? ` · ${nextClass.room}` : ''
                }.`
              : classes.length
                ? 'Your classes are done for today.'
                : 'No classes today. A good day to get ahead.'}
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => onNavigate('timetable')}>
              Open timetable
            </button>
            <button className="btn ghost" onClick={() => onNavigate('desk')}>
              Ask my notes
            </button>
          </div>
        </div>
        <div className="next-card">
          {nextClass ? (
            <>
              <p className="eyebrow">Next class</p>
              <h3>{nextClass.title}</h3>
              <p className="next-time">
                {fmtTime(nextClass.startMin)} – {fmtTime(nextClass.endMin)}
              </p>
              <p className="muted">
                {[nextClass.room, subject(nextClass.subjectId)?.teacher]
                  .filter(Boolean)
                  .join(' · ') || 'No room set'}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Next class</p>
              <h3>Nothing left today</h3>
              <p className="muted">
                {revision.length
                  ? `You have ${revision.length} revision block${
                      revision.length === 1 ? '' : 's'
                    } planned instead.`
                  : 'Use the free hours to clear a deadline.'}
              </p>
            </>
          )}
        </div>
      </section>

      {cardsDue > 0 ? (
        <section className="review-strip">
          <div>
            <p className="eyebrow">Review</p>
            <h3>
              {cardsDue === 1
                ? 'One card is due today'
                : `${cardsDue} cards are due today`}
            </h3>
            <p className="muted">
              {data.notebooks.length > 1 ? 'Across all your notebooks. ' : ''}
              {data.review.fresh
                ? `${data.review.fresh} new · ${data.review.due} coming back. `
                : ''}
              {data.reviewStats.streak > 0
                ? `${data.reviewStats.streak} day streak. `
                : ''}
              Ten minutes of recall now beats an hour of rereading later.
            </p>
          </div>
          <button className="btn primary" onClick={() => onNavigate('review')}>
            Review now
          </button>
        </section>
      ) : data.reviewStats.streak > 0 ? (
        <section className="review-strip quiet">
          <div>
            <p className="eyebrow">Review</p>
            <h3>
              {data.reviewStats.streak === 1
                ? 'One day in a row'
                : `${data.reviewStats.streak} days in a row`}
            </h3>
            <p className="muted">
              Nothing due today
              {data.review.nextDue
                ? `. The next cards come back on ${fmtDate(data.review.nextDue)}`
                : ''}
              .
            </p>
          </div>
          <button className="btn ghost" onClick={() => onNavigate('review')}>
            Open review
          </button>
        </section>
      ) : null}

      <DayCheckin />

      <SessionTimer />

      <ChapterRevisits />

      <div className="stats">
        <div className="stat">
          <strong>{classes.length}</strong>
          <span>classes today</span>
        </div>
        <div className="stat">
          <strong>{open.length}</strong>
          <span>{overdue ? `${overdue} overdue` : 'open tasks'}</span>
        </div>
        <div className="stat">
          <strong>{data.notes.length}</strong>
          <span>notes saved</span>
        </div>
        <div className="stat">
          <strong>
            {nextExam ? daysBetween(today, nextExam.examDate) : '-'}
          </strong>
          <span>{nextExam ? `days to ${nextExam.name}` : 'no exams set'}</span>
        </div>
      </div>

      <div className="columns">
        <section className="card">
          <div className="card-head">
            <h3>Today’s schedule</h3>
            <span className="count">{classes.length + revision.length}</span>
          </div>
          {classes.length + revision.length === 0 ? (
            <p className="empty-line">Nothing scheduled. Your evening is yours.</p>
          ) : (
            <ul className="agenda">
              {[...classes, ...revision]
                .sort((a, b) => a.startMin - b.startMin)
                .map((entry) => {
                  const tone = subject(entry.subjectId)?.color ?? '#5f6d5f'
                  return (
                    <li key={entry.id} className="agenda-row">
                      <span className="agenda-time">{fmtTime(entry.startMin)}</span>
                      <span className="agenda-bar" style={{ background: tone }} />
                      <span className="agenda-main">
                        <strong>{entry.title}</strong>
                        <span className="muted">
                          {[entry.room, entry.kind === 'study' ? 'Revision' : '']
                            .filter(Boolean)
                            .join(' · ') || fmtTime(entry.endMin)}
                        </span>
                      </span>
                    </li>
                  )
                })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Due in the next week</h3>
            <button className="btn ghost small" onClick={() => onNavigate('work')}>
              All work
            </button>
          </div>
          {dueSoon.length === 0 ? (
            <p className="empty-line">Nothing due this week. Keep it that way.</p>
          ) : (
            <ul className="task-list">
              {dueSoon.map((task) => (
                <li key={task.id} className="task-row">
                  <input
                    type="checkbox"
                    checked={task.done}
                    aria-label={`Mark ${task.title} done`}
                    onChange={() => void saveTask(taskInput(task, !task.done), task.id)}
                  />
                  <span className="task-main">
                    <span className="task-title">{task.title}</span>
                    <span className="task-meta">
                      {subject(task.subjectId)?.name ?? 'General'}
                      {' · '}
                      <span className={task.dueDate < today ? 'overdue' : ''}>
                        {task.dueDate
                          ? daysBetween(today, task.dueDate) === 0
                            ? 'Today'
                            : daysBetween(today, task.dueDate) === 1
                              ? 'Tomorrow'
                              : daysBetween(today, task.dueDate) < 0
                                ? 'Overdue'
                                : `In ${daysBetween(today, task.dueDate)} days`
                          : 'No date'}
                      </span>
                    </span>
                  </span>
                  <span className={`prio prio-${task.priority}`}>{task.priority}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Your week in review</h3>
          <span className="count">
            {week.loggedNights} of {week.nights.length} evenings checked in
          </span>
        </div>
        {!week.plannedNights && !week.loggedNights ? (
          <p className="empty-line">
            No revision was planned in the last seven evenings and no check-in
            was saved. Build a revision plan and check in your day, and this
            compares the two.
          </p>
        ) : (
          <>
            <p className="muted">
              {week.plannedNights
                ? `${fmtDuration(week.plannedMinutes)} of revision was planned for ${week.plannedNights} evening${week.plannedNights === 1 ? '' : 's'}. You checked in on ${week.checkedInNights} of them.`
                : 'Revision was planned, but not in the last seven evenings.'}
            </p>
            {week.skippedMinutes ? (
              <p className="muted">
                <strong>{fmtDuration(week.skippedMinutes)}</strong> of planned
                study fell on evenings you never checked in
                {week.worst ? (
                  <>
                    {' '}
                    — mostly <strong>{week.worst.name}</strong>.
                  </>
                ) : (
                  '.'
                )}
              </p>
            ) : week.plannedNights ? (
              <p className="muted">
                Nothing was skipped: every evening with planned study was
                checked in.
              </p>
            ) : null}
            <ul className="agenda">
              {week.nights.map((night) => (
                <li key={night.date} className="agenda-row">
                  <span className="agenda-time">
                    {DAY_SHORT[dayIndexOf(night.date)]}
                  </span>
                  <span
                    className="agenda-bar"
                    style={{
                      background: night.checkedIn
                        ? '#3f6b52'
                        : night.plannedMinutes
                          ? '#b25b3a'
                          : 'var(--line-strong)',
                    }}
                  />
                  <span className="agenda-main">
                    <strong>{fmtDate(night.date)}</strong>
                    <span className="muted">
                      {night.plannedMinutes
                        ? `${fmtDuration(night.plannedMinutes)} planned`
                        : 'No revision planned'}
                      {' · '}
                      {night.checkedIn
                        ? 'checked in'
                        : night.plannedMinutes
                          ? 'never checked in'
                          : 'nothing to check'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {week.subjects.length ? (
              <>
                <div className="card-head">
                  <h4>Subjects you skipped</h4>
                  <span className="count">{week.subjects.length}</span>
                </div>
                <ul className="health-rows">
                  {week.subjects.map((row) => (
                    <li
                      key={row.subjectId ?? 'general'}
                      className="health-row"
                    >
                      <span
                        className="subject-dot"
                        style={{ background: row.color }}
                      />
                      <div className="health-main">
                        <div className="health-head">
                          <strong>{row.name}</strong>
                          <span className="health-chip is-behind">
                            {fmtDuration(row.skippedMinutes)} skipped
                          </span>
                        </div>
                        <span className="health-note">
                          {row.eveningsPlanned} evening
                          {row.eveningsPlanned === 1 ? '' : 's'} planned ·{' '}
                          checked in on {row.eveningsCheckedIn}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="fineprint">
                  An evening only counts here when a check-in was saved for it,
                  so a block left on the timetable from that night is treated as
                  skipped. Tonight is not counted yet.
                </p>
              </>
            ) : null}
          </>
        )}
      </section>

      {revisionSheetData.rows.length ? (
        <section className="card">
          <div className="card-head">
            <h3>Revision sheet</h3>
            <span className="count">{revisionSheetData.rows.length} subject{revisionSheetData.rows.length === 1 ? '' : 's'}</span>
          </div>
          <p className="muted">
            Sorted by urgency: the most behind first, then exam proximity.
          </p>
          <ul className="revision-rows">
            {revisionSheetData.rows.map((row) => (
              <li key={row.subjectId} className="revision-row">
                <span className="subject-dot" style={{ background: row.subjectName ? (data.subjects.find((s) => s.id === row.subjectId)?.color ?? '#5f6d5f') : '#5f6d5f' }} />
                <div className="revision-main">
                  <div className="revision-head">
                    <strong>{row.subjectName}</strong>
                    <span className={`status-chip is-${row.status}`}>{row.status}</span>
                  </div>
                  <span className="muted">
                    {row.chaptersLeft === 0
                      ? row.chaptersTotal === 0
                        ? 'No chapters set'
                        : `All ${row.chaptersTotal} chapters ticked`
                      : `${row.chaptersLeft} of ${row.chaptersTotal} chapter${row.chaptersTotal === 1 ? '' : 's'} left`}
                    {' · '}
                    {row.examDate === '—'
                      ? 'no exam set'
                      : `exam ${fmtDate(row.examDate)}`}
                    {row.overdueTasks > 0 ? ` · ${row.overdueTasks} overdue task${row.overdueTasks === 1 ? '' : 's'}` : ''}
                    {row.mistakes > 0 ? ` · ${row.mistakes} card${row.mistakes === 1 ? '' : 's'} to retry` : ''}
                  </span>
                </div>
                <span className="revision-bar">
                  <span style={{ width: `${Math.min(100, Math.round(((row.chaptersTotal - row.chaptersLeft) / Math.max(1, row.chaptersTotal)) * 100))}%`, background: row.status === 'behind' ? '#b25b3a' : row.status === 'watch' ? '#c98a2b' : '#3f6b52' }} />
                </span>
                <span className="revision-hours">{row.revisionHoursPerWeek > 0 ? `${row.revisionHoursPerWeek}h/wk` : '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {examRows.length ? (
        <section className="card">
          <div className="card-head">
            <h3>Chapters before your exams</h3>
            <button className="btn ghost small" onClick={() => onNavigate('syllabus')}>
              Open syllabus
            </button>
          </div>
          <ul className="exam-rows">
            {examRows.map(({ subject: item, total, done }) => {
              const left = total - done
              const percent = Math.round((done / total) * 100)
              return (
                <li key={item.id} className="exam-row">
                  <span className="subject-dot" style={{ background: item.color }} />
                  <span className="exam-main">
                    <strong>{item.name}</strong>
                    <span className="muted">
                      {left === 0
                        ? `All ${total} chapters ticked`
                        : `${left} of ${total} chapter${total === 1 ? '' : 's'} left`}
                      {' · exam '}
                      {fmtDate(item.examDate)}
                    </span>
                  </span>
                  <span className="exam-bar">
                    <span style={{ width: `${percent}%`, background: item.color }} />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
