import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Entry, EntryInput, EntryKind, Plan, Subject } from '../shared/types'
import {
  DAY_SHORT,
  addDays,
  dayIndexOf,
  fmtDate,
  fmtDuration,
  fmtTime,
  parseTimeValue,
  toTimeValue,
  todayISO,
  weekStartOf,
} from './dates'
import { buildRevisionPlan } from './plan'
import { subjectHealth } from './subjectHealth'
import { useWorkspace } from './workspace'

const DAY_START = 7 * 60
const DAY_END = 21 * 60
const ROWS = (DAY_END - DAY_START) / 60

type Column = {
  key: string
  label: string
  sublabel: string
  entries: Entry[]
}

function layOut(entries: Entry[]) {
  const result = new Map<string, { lane: number; lanes: number }>()
  const sorted = [...entries].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  )
  let cluster: Entry[] = []
  let clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const ends: number[] = []
    const placed = cluster.map((entry) => {
      let lane = ends.findIndex((end) => end <= entry.startMin)
      if (lane === -1) {
        lane = ends.length
        ends.push(entry.endMin)
      } else {
        ends[lane] = entry.endMin
      }
      return { entry, lane }
    })
    for (const { entry, lane } of placed)
      result.set(entry.id, { lane, lanes: ends.length })
    cluster = []
    clusterEnd = -1
  }
  for (const entry of sorted) {
    if (cluster.length && entry.startMin >= clusterEnd) flush()
    cluster.push(entry)
    clusterEnd = Math.max(clusterEnd, entry.endMin)
  }
  flush()
  return result
}

/**
 * Opaque subject tint, so the hour grid never shows through a block. Mixed
 * with the card colour rather than a fixed cream, so it follows the theme.
 */
function tint(color: string): string {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : '#5f6d5f'
  return `color-mix(in srgb, ${hex} 15%, var(--card))`
}

function hourLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const suffix = hours >= 12 ? 'pm' : 'am'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour} ${suffix}`
}

export default function Timetable() {
  const { data, replacePlan } = useWorkspace()
  const [plan, setPlan] = useState<Plan>('regular')
  const [weekOffset, setWeekOffset] = useState(0)
  const [editor, setEditor] = useState<{ entry: Entry | null; plan: Plan } | null>(null)
  const [showSubjects, setShowSubjects] = useState(false)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [from, setFrom] = useState(todayISO())
  const [hours, setHours] = useState(3)
  const [weekends, setWeekends] = useState(true)
  const weekScroll = useRef<HTMLDivElement | null>(null)
  const [weekOverflow, setWeekOverflow] = useState(false)

  useEffect(() => {
    const scroll = weekScroll.current
    if (!scroll) return
    const sync = () =>
      setWeekOverflow(scroll.scrollWidth > scroll.clientWidth + 1)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(scroll)
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [plan, weekOffset, data.entries.length])

  const today = todayISO()
  // The same rows the Subject health page ranks, so the plan shares its score.
  const health = useMemo(
    () =>
      subjectHealth({
        subjects: data.subjects,
        syllabus: data.syllabus,
        tasks: data.tasks,
        classLevel: data.profile?.classLevel ?? 10,
        today,
      }),
    [data.profile, data.syllabus, data.subjects, data.tasks, today],
  )
  const weekStart = addDays(weekStartOf(today), weekOffset * 7)
  const colorOf = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.color ?? '#5f6d5f'

  const columns: Column[] =
    plan === 'regular'
      ? DAY_SHORT.map((label, index) => ({
          key: `day-${index}`,
          label,
          sublabel: index === dayIndexOf(today) ? 'Today' : '',
          entries: data.entries.filter(
            (entry) => entry.plan === 'regular' && entry.day === index,
          ),
        }))
      : Array.from({ length: 7 }, (_, index) => {
          const date = addDays(weekStart, index)
          return {
            key: date,
            label: DAY_SHORT[index]!,
            sublabel: date === today ? 'Today' : fmtDate(date),
            entries: data.entries.filter(
              (entry) => entry.plan === 'intensive' && entry.date === date,
            ),
          }
        })

  const layouts = new Map<string, { lane: number; lanes: number }>()
  for (const column of columns) {
    for (const [id, layout] of layOut(column.entries)) layouts.set(id, layout)
  }

  const weekSessions = columns.reduce(
    (total, column) => total + column.entries.length,
    0,
  )

  async function generate() {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      const result = buildRevisionPlan({
        subjects: data.subjects,
        regular: data.entries.filter((entry) => entry.plan === 'regular'),
        health,
        from,
        hoursPerDay: hours,
        includeWeekends: weekends,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      const count = await replacePlan(result.entries)
      setPlan('intensive')
      setWeekOffset(0)
      setFlash(
        `Plan built: ${result.sessions} study sessions across ${result.days} days, plus ${result.entries.length - result.sessions} exam slots.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the plan.')
    } finally {
      setBusy(false)
    }
  }

  async function clearPlan() {
    if (!window.confirm('Clear every block in the revision plan?')) return
    setBusy(true)
    try {
      await replacePlan([])
      setFlash('Revision plan cleared.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the plan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="week-toolbar">
        <div className="segmented" role="group" aria-label="Timetable view">
          <button
            type="button"
            className={plan === 'regular' ? 'seg active' : 'seg'}
            onClick={() => {
              setPlan('regular')
              setWeekOffset(0)
            }}
          >
            My week
          </button>
          <button
            type="button"
            className={plan === 'intensive' ? 'seg active' : 'seg'}
            onClick={() => setPlan('intensive')}
          >
            Revision plan
          </button>
        </div>
        <div className="toolbar-actions">
          {plan === 'intensive' ? (
            <>
              <span className="week-label">
                {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}
              </span>
              <button
                className="btn ghost small"
                onClick={() => setWeekOffset((value) => value - 1)}
                aria-label="Previous week"
              >
                ‹
              </button>
              <button className="btn ghost small" onClick={() => setWeekOffset(0)}>
                This week
              </button>
              <button
                className="btn ghost small"
                onClick={() => setWeekOffset((value) => value + 1)}
                aria-label="Next week"
              >
                ›
              </button>
            </>
          ) : (
            <span className="week-label">
              Term week · {weekSessions} block{weekSessions === 1 ? '' : 's'}
            </span>
          )}
          <button className="btn ghost" onClick={() => setShowSubjects((value) => !value)}>
            Subjects
          </button>
          <a className="btn ghost" href="/api/timetable.ics" download>
            Calendar file
          </a>
          {plan === 'regular' ? (
            <button
              className="btn primary"
              onClick={() => setEditor({ entry: null, plan: 'regular' })}
            >
              Add class
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => setEditor({ entry: null, plan: 'intensive' })}
            >
              Add study block
            </button>
          )}
        </div>
      </div>

      {flash ? <p className="notice">{flash}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {showSubjects ? <SubjectPanel /> : null}

      {plan === 'intensive' ? (
        <section className="card builder-card">
          <div className="card-head">
            <h3>Build the revision plan</h3>
            <span className="count">
              {data.subjects.filter((subject) => subject.examDate).length} exam
              dates
            </span>
          </div>
          <p className="muted builder-copy">
            Studydeck reads your real week, skips your classes, and shares each
            day out by the same score Subject health ranks by — so the subject
            furthest behind gets the most time, and a subject with every chapter
            ticked waits. Every block stays editable.
          </p>
          <div className="builder-grid">
            <label className="field">
              <span>Start from</span>
              <input
                type="date"
                value={from}
                min={today}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Hours each day</span>
              <input
                type="number"
                min={1}
                max={12}
                step={0.5}
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={weekends}
                onChange={(event) => setWeekends(event.target.checked)}
              />
              <span>Include weekends</span>
            </label>
            <div className="builder-actions">
              <button className="btn primary" disabled={busy} onClick={() => void generate()}>
                {busy ? 'Building…' : 'Generate plan'}
              </button>
              {data.entries.some((entry) => entry.plan === 'intensive') ? (
                <button className="btn ghost" disabled={busy} onClick={() => void clearPlan()}>
                  Clear plan
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="card week-card">
        <div className="week-scroll" ref={weekScroll}>
          <div className="week-inner">
            <div className="week-head">
              <span className="week-gutter" />
              {columns.map((column) => (
                <div className="day-head" key={column.key}>
                  <strong>{column.label}</strong>
                  <span>{column.sublabel}</span>
                </div>
              ))}
            </div>
            <div className="week-body">
              <div className="hours">
                {Array.from({ length: ROWS }, (_, index) => (
                  <span
                    key={index}
                    className="hour-label"
                    style={{ top: `${(index / ROWS) * 100}%` }}
                  >
                    {hourLabel(DAY_START + index * 60)}
                  </span>
                ))}
              </div>
              {columns.map((column) => (
                <div className="day-col" key={column.key}>
                  {column.entries.map((entry) => {
                    if (entry.endMin <= DAY_START || entry.startMin >= DAY_END)
                      return null
                    const start = Math.max(entry.startMin, DAY_START)
                    const end = Math.min(entry.endMin, DAY_END)
                    const layout = layouts.get(entry.id) ?? { lane: 0, lanes: 1 }
                    const color = colorOf(entry.subjectId)
                    const minutes = end - start
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        title={`${entry.title} · ${fmtTime(entry.startMin)}–${fmtTime(
                          entry.endMin,
                        )}${entry.room ? ` · ${entry.room}` : ''}`}
                        className={`block block-${entry.kind}`}
                        style={{
                          top: `${((start - DAY_START) / (DAY_END - DAY_START)) * 100}%`,
                          height: `calc(${((end - start) / (DAY_END - DAY_START)) * 100}% - 2px)`,
                          left: `calc(${(layout.lane / layout.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / layout.lanes}% - 4px)`,
                          borderLeftColor: color,
                          backgroundColor: tint(color),
                        }}
                        onClick={() => setEditor({ entry, plan: entry.plan })}
                      >
                        {minutes >= 35 ? (
                          <span className="block-time">{fmtTime(entry.startMin)}</span>
                        ) : null}
                        <span className="block-title">{entry.title}</span>
                        {minutes >= 55 && entry.room ? (
                          <span className="block-meta">{entry.room}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        {weekOverflow ? (
          <p className="week-swipe muted small">
            Swipe sideways for the rest of the week.
          </p>
        ) : null}
        {plan === 'intensive' &&
        !data.entries.some((entry) => entry.plan === 'intensive') ? (
          <p className="empty-line">
            No revision plan yet. Set exam dates on your subjects, then generate
            one above.
          </p>
        ) : null}
      </section>

      {editor ? (
        <EntryEditor
          entry={editor.entry}
          plan={editor.plan}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  )
}

type Draft = {
  title: string
  subjectId: string
  kind: EntryKind
  day: number
  date: string
  start: string
  end: string
  room: string
}

function EntryEditor({
  entry,
  plan,
  onClose,
}: {
  entry: Entry | null
  plan: Plan
  onClose: () => void
}) {
  const { data, saveEntry, deleteEntry } = useWorkspace()
  const [draft, setDraft] = useState<Draft>({
    title: entry?.title ?? '',
    subjectId: entry?.subjectId ?? data.subjects[0]?.id ?? '',
    kind: entry?.kind ?? 'class',
    day: entry?.day ?? dayIndexOf(todayISO()),
    date: entry?.date || todayISO(),
    start: toTimeValue(entry?.startMin ?? 9 * 60),
    end: toTimeValue(entry?.endMin ?? 10 * 60),
    room: entry?.room ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const patch = (values: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...values }))

  const startMin = parseTimeValue(draft.start)
  const endMin = parseTimeValue(draft.end)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (endMin <= startMin) {
      setError('The finish time must be after the start time.')
      return
    }
    if (plan === 'intensive' && !draft.date) {
      setError('Pick a date for this block.')
      return
    }
    setBusy(true)
    setError('')
    const input: EntryInput = {
      subjectId: draft.subjectId || null,
      title: draft.title.trim(),
      kind: draft.kind,
      day: plan === 'intensive' ? dayIndexOf(draft.date) : draft.day,
      startMin,
      endMin,
      room: draft.room.trim(),
      plan,
      date: plan === 'intensive' ? draft.date : '',
    }
    try {
      await saveEntry(input, entry?.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this block.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!entry) return
    setBusy(true)
    try {
      await deleteEntry(entry.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this block.')
      setBusy(false)
    }
  }

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={entry ? 'Edit block' : 'New block'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">{plan === 'intensive' ? 'Revision plan' : 'My week'}</p>
            <h3>{entry ? 'Edit block' : plan === 'intensive' ? 'New study block' : 'New class'}</h3>
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="drawer-body" onSubmit={submit}>
          <label className="field">
            <span>Title</span>
            <input
              value={draft.title}
              maxLength={60}
              placeholder={draft.kind === 'class' ? 'e.g. Mathematics' : 'e.g. Past papers'}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Subject</span>
              <select
                value={draft.subjectId}
                onChange={(event) => patch({ subjectId: event.target.value })}
              >
                <option value="">No subject</option>
                {data.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={draft.kind}
                onChange={(event) => patch({ kind: event.target.value as EntryKind })}
              >
                <option value="class">Class</option>
                <option value="study">Study block</option>
                <option value="exam">Exam</option>
                <option value="break">Break</option>
              </select>
            </label>
          </div>
          {plan === 'intensive' ? (
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={draft.date}
                onChange={(event) => patch({ date: event.target.value })}
              />
            </label>
          ) : (
            <label className="field">
              <span>Day</span>
              <select
                value={draft.day}
                onChange={(event) => patch({ day: Number(event.target.value) })}
              >
                {DAY_SHORT.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-row">
            <label className="field">
              <span>Starts</span>
              <input
                type="time"
                value={draft.start}
                onChange={(event) => patch({ start: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Ends</span>
              <input
                type="time"
                value={draft.end}
                onChange={(event) => patch({ end: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Room or place</span>
            <input
              value={draft.room}
              maxLength={40}
              placeholder="Room 12, library…"
              onChange={(event) => patch({ room: event.target.value })}
            />
          </label>
          <p className="fineprint">
            {endMin > startMin ? fmtDuration(endMin - startMin) : 'Check the times'}
          </p>
          {error ? <p className="error small">{error}</p> : null}
          <div className="drawer-foot">
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save block'}
            </button>
            {entry ? (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}

function SubjectPanel() {
  const { data, saveSubject, deleteSubject } = useWorkspace()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', color: '#3f6b52', teacher: '', examDate: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const patch = (values: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...values }))

  function reset() {
    setEditingId(null)
    setForm({ name: '', color: '#3f6b52', teacher: '', examDate: '' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Give the subject a name.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveSubject(form, editingId ?? undefined)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the subject.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(subject: Subject) {
    if (!window.confirm(`Delete ${subject.name}? Its blocks stay but lose the subject label.`))
      return
    try {
      await deleteSubject(subject.id)
      if (editingId === subject.id) reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the subject.')
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Subjects</h3>
        <span className="count">{data.subjects.length}</span>
      </div>
      <div className="subject-layout">
        <ul className="subject-list">
          {data.subjects.length === 0 ? (
            <li className="empty-line">No subjects yet. Add your first one.</li>
          ) : (
            data.subjects.map((subject) => (
              <li key={subject.id} className="subject-row">
                <span className="subject-dot" style={{ background: subject.color }} />
                <span className="subject-main">
                  <strong>{subject.name}</strong>
                  <span className="muted">
                    {subject.teacher || 'No teacher'} ·{' '}
                    {subject.examDate ? `Exam ${fmtDate(subject.examDate)}` : 'No exam date'}
                  </span>
                </span>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setEditingId(subject.id)
                    setForm({
                      name: subject.name,
                      color: subject.color,
                      teacher: subject.teacher,
                      examDate: subject.examDate,
                    })
                  }}
                >
                  Edit
                </button>
                <button className="btn ghost small" onClick={() => void remove(subject)}>
                  Delete
                </button>
              </li>
            ))
          )}
        </ul>
        <form className="subject-form" onSubmit={submit}>
          <label className="field">
            <span>{editingId ? 'Edit subject' : 'New subject'}</span>
            <input
              value={form.name}
              maxLength={40}
              placeholder="Chemistry"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Colour</span>
              <input
                type="color"
                value={form.color}
                onChange={(event) => patch({ color: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Teacher</span>
              <input
                value={form.teacher}
                maxLength={40}
                placeholder="Optional"
                onChange={(event) => patch({ teacher: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Exam date (powers the revision plan)</span>
            <input
              type="date"
              value={form.examDate}
              onChange={(event) => patch({ examDate: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save subject' : 'Add subject'}
            </button>
            {editingId ? (
              <button type="button" className="btn ghost" onClick={reset}>
                Cancel
              </button>
            ) : null}
          </div>
          {error ? <p className="error small">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}
