import { useEffect, useState, type FormEvent } from 'react'
import type { Priority, Task, TaskInput } from '../shared/types'
import { daysBetween, dueLabel, fmtDate, todayISO } from './dates'
import { useWorkspace } from './workspace'

function toInput(task: Task, done = task.done) {
  return {
    subjectId: task.subjectId,
    title: task.title,
    dueDate: task.dueDate,
    priority: task.priority,
    details: task.details,
    done,
  }
}

export default function Work({
  focus,
  onFocused,
}: {
  focus?: string | null
  onFocused?: () => void
}) {
  const { data, saveTask, deleteTask } = useWorkspace()
  const [title, setTitle] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [dueDate, setDueDate] = useState(todayISO())
  const [priority, setPriority] = useState<Priority>('normal')
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TaskInput | null>(null)

  const today = todayISO()
  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'
  const subjectColor = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.color ?? '#7b857d'

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Give the task a title.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveTask({
        title: title.trim(),
        subjectId: subjectId || null,
        dueDate,
        priority,
        details: '',
        done: false,
      })
      setTitle('')
      setPriority('normal')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the task.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id)
    setDraft({
      subjectId: task.subjectId,
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
      details: task.details,
      done: task.done,
    })
    setError('')
  }

  function stopEdit() {
    setEditingId(null)
    setDraft(null)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!draft || !editingId) return
    if (!draft.title.trim()) {
      setError('Give the task a title.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveTask({ ...draft, title: draft.title.trim() }, editingId)
      stopEdit()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the task.')
    } finally {
      setBusy(false)
    }
  }

  // A task found by the search box shows even when the filter hides it.
  useEffect(() => {
    if (!focus) return
    setFilter('all')
    window.setTimeout(() => {
      document
        .getElementById(`task-${focus}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    onFocused?.()
  }, [focus])

  const visible = data.tasks.filter((task) =>
    filter === 'open' ? !task.done : filter === 'done' ? task.done : true,
  )
  const byDue = (a: Task, b: Task) =>
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
    b.createdAt - a.createdAt
  const overdue = visible.filter(
    (task) => !task.done && task.dueDate && task.dueDate < today,
  )
  const todayTasks = visible.filter((task) => !task.done && task.dueDate === today)
  const soon = visible.filter(
    (task) =>
      !task.done &&
      task.dueDate &&
      task.dueDate > today &&
      daysBetween(today, task.dueDate) <= 7,
  )
  const later = visible.filter(
    (task) =>
      !task.done && task.dueDate && daysBetween(today, task.dueDate) > 7,
  )
  const undated = visible.filter((task) => !task.done && !task.dueDate)
  const done = visible.filter((task) => task.done)

  const groups = [
    { key: 'overdue', label: 'Overdue', tone: 'rose', tasks: overdue.sort(byDue) },
    { key: 'today', label: 'Today', tone: 'amber', tasks: todayTasks.sort(byDue) },
    { key: 'soon', label: 'Next 7 days', tone: 'green', tasks: soon.sort(byDue) },
    { key: 'later', label: 'Later', tone: 'muted', tasks: later.sort(byDue) },
    { key: 'undated', label: 'No due date', tone: 'muted', tasks: undated.sort(byDue) },
    { key: 'done', label: 'Done', tone: 'muted', tasks: done.sort(byDue) },
  ].filter((group) => group.tasks.length > 0)

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>Add work</h3>
          <span className="count">
            {data.tasks.filter((task) => !task.done).length} open
          </span>
        </div>
        <form className="task-form" onSubmit={add}>
          <label className="field grow">
            <span>What needs doing?</span>
            <input
              value={title}
              maxLength={120}
              placeholder="Finish the biology lab report"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Subject</span>
            <select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">General</option>
              {data.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Priority</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add task'}
          </button>
        </form>
        {error ? <p className="error small">{error}</p> : null}
      </section>

      <div className="week-toolbar">
        <div className="segmented" role="group" aria-label="Filter tasks">
          {(['open', 'done', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'seg active' : 'seg'}
              onClick={() => setFilter(value)}
            >
              {value === 'open' ? 'Open' : value === 'done' ? 'Done' : 'Everything'}
            </button>
          ))}
        </div>
        <span className="week-label">
          {data.tasks.filter((task) => !task.done).length} open ·{' '}
          {data.tasks.filter((task) => task.done).length} done
        </span>
      </div>

      {groups.length === 0 ? (
        <section className="card">
          <p className="empty-line">
            {filter === 'done'
              ? 'Nothing finished yet.'
              : 'No work on the list. Add the next deadline above.'}
          </p>
        </section>
      ) : (
        groups.map((group) => (
          <section className="card" key={group.key}>
            <div className="card-head">
              <h3 className={`group-${group.tone}`}>{group.label}</h3>
              <span className="count">{group.tasks.length}</span>
            </div>
            <ul className="task-list">
              {group.tasks.map((task) => (
                <li key={task.id} id={`task-${task.id}`} className="task-item">
                  {editingId === task.id && draft ? (
                    <form className="task-edit" onSubmit={saveEdit}>
                      <label className="field">
                        <span>Task</span>
                        <input
                          value={draft.title}
                          maxLength={120}
                          onChange={(event) =>
                            setDraft({ ...draft, title: event.target.value })
                          }
                        />
                      </label>
                      <div className="task-edit-row">
                        <label className="field">
                          <span>Subject</span>
                          <select
                            value={draft.subjectId ?? ''}
                            onChange={(event) =>
                              setDraft({ ...draft, subjectId: event.target.value || null })
                            }
                          >
                            <option value="">General</option>
                            {data.subjects.map((subject) => (
                              <option key={subject.id} value={subject.id}>
                                {subject.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Due</span>
                          <input
                            type="date"
                            value={draft.dueDate}
                            onChange={(event) =>
                              setDraft({ ...draft, dueDate: event.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Priority</span>
                          <select
                            value={draft.priority}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                priority: event.target.value as Priority,
                              })
                            }
                          >
                            <option value="high">High</option>
                            <option value="normal">Normal</option>
                            <option value="low">Low</option>
                          </select>
                        </label>
                      </div>
                      <label className="field">
                        <span>Details</span>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={draft.details}
                          placeholder="Pages, question numbers, what exactly to submit…"
                          onChange={(event) =>
                            setDraft({ ...draft, details: event.target.value })
                          }
                        />
                      </label>
                      <div className="form-actions">
                        <button className="btn primary small" disabled={busy}>
                          {busy ? 'Saving…' : 'Save task'}
                        </button>
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={stopEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                  <div className="task-row">
                  <input
                    type="checkbox"
                    checked={task.done}
                    aria-label={`Mark ${task.title} ${task.done ? 'not done' : 'done'}`}
                    onChange={() => void saveTask(toInput(task, !task.done), task.id)}
                  />
                  <span className="task-main">
                    <span className={task.done ? 'task-title done' : 'task-title'}>
                      {task.title}
                    </span>
                    <span className="task-meta">
                      <span
                        className="dot"
                        style={{ background: subjectColor(task.subjectId) }}
                      />
                      {subjectName(task.subjectId)}
                      {' · '}
                      <span
                        className={
                          !task.done && task.dueDate && task.dueDate < today
                            ? 'overdue'
                            : ''
                        }
                      >
                        {task.dueDate ? `${dueLabel(task.dueDate)} · ${fmtDate(task.dueDate)}` : 'No due date'}
                      </span>
                      {task.details ? ` · ${task.details}` : ''}
                    </span>
                  </span>
                  <span className={`prio prio-${task.priority}`}>{task.priority}</span>
                  <button
                    className="btn ghost small"
                    onClick={() => startEdit(task)}
                    aria-label={`Edit ${task.title}`}
                  >
                    Edit
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => void deleteTask(task.id)}
                    aria-label={`Delete ${task.title}`}
                  >
                    Delete
                  </button>
                  </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
