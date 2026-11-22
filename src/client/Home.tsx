import { unitsFor } from '../shared/curriculum'
import type { Task } from '../shared/types'
import type { Tab } from './Shell'
import {
  daysBetween,
  fmtDate,
  fmtDateLong,
  fmtTime,
  greeting,
  minutesNow,
  todayISO,
  dayIndexOf,
} from './dates'
import { useWorkspace } from './workspace'

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
