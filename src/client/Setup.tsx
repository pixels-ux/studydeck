import { useMemo, useState } from 'react'
import { CLASS_LEVELS, curriculumFor } from '../shared/curriculum'
import { api } from './api'
import {
  DAY_LONG,
  fmtTime,
  parseTimeValue,
  toTimeValue,
  todayISO,
} from './dates'
import { buildSchoolTimetable } from './schoolTimetable'
import { buildSetupPayload, subjectKeys } from './setupPayload'
import {
  formatTimetable,
  parseTimetable,
  TIMETABLE_HINT,
} from './timetableText'
import { useWorkspace } from './workspace'

type Test = { id: string; name: string; date: string; subjects: string[] }

const STEPS = ['Your class', 'Your day', 'Your tests', 'Your timetable']

export default function Setup({ onDone }: { onDone?: () => void }) {
  const { data, applySetup } = useWorkspace()
  const existing = data.profile
  const [step, setStep] = useState(0)
  // The class is the student's answer, not ours: it stays empty until they pick.
  const [classLevel, setClassLevel] = useState<number | null>(
    existing?.classLevel ?? null,
  )
  const [chosen, setChosen] = useState<string[]>(() =>
    existing && data.subjects.length
      ? data.subjects.map((subject) => subject.name)
      : [],
  )
  const [days, setDays] = useState<number[]>(
    existing?.schoolDays ?? [0, 1, 2, 3, 4, 5],
  )
  // The timetable is what the student already has, so an existing copy is the
  // starting point; a new student types it (or fills a typical week and edits).
  const [timetableText, setTimetableText] = useState(() => {
    const day = existing?.schoolDays[0] ?? 0
    return formatTimetable(
      data.entries
        .filter(
          (entry) =>
            entry.plan === 'regular' &&
            entry.day === day &&
            entry.kind === 'class' &&
            entry.title !== 'Coaching',
        )
        .map((entry) => ({
          startMin: entry.startMin,
          endMin: entry.endMin,
          subjectName: entry.title,
        })),
    )
  })
  const existingCoaching = data.entries.find(
    (entry) => entry.plan === 'regular' && entry.title === 'Coaching',
  )
  const [coachingOn, setCoachingOn] = useState(Boolean(existingCoaching))
  const [coachingDays, setCoachingDays] = useState<number[]>(() => {
    const found = data.entries
      .filter((entry) => entry.plan === 'regular' && entry.title === 'Coaching')
      .map((entry) => entry.day)
    return found.length ? [...new Set(found)].sort((a, b) => a - b) : [0, 1, 2, 3, 4]
  })
  const [coachingStart, setCoachingStart] = useState(
    toTimeValue(existingCoaching?.startMin ?? 16 * 60),
  )
  const [coachingEnd, setCoachingEnd] = useState(
    toTimeValue(existingCoaching?.endMin ?? 17 * 60 + 30),
  )
  const [studyHours, setStudyHours] = useState(existing?.studyHours ?? 3)
  const [tests, setTests] = useState<Test[]>([
    { id: crypto.randomUUID(), name: 'Unit test', date: '', subjects: [] },
  ])
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function removeEverything() {
    if (
      !window.confirm(
        'Delete your whole workspace? Your notes, tasks, timetable and syllabus ticks will be gone. This cannot be undone.',
      )
    )
      return
    setDeleting(true)
    setError('')
    try {
      await api<unknown>('/api/workspace', { method: 'DELETE' })
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete your data.')
      setDeleting(false)
    }
  }

  const curriculum = useMemo(
    () => (classLevel === null ? [] : curriculumFor(classLevel)),
    [classLevel],
  )
  const options = useMemo(() => {
    const names = curriculum.map((subject) => subject.name)
    for (const name of chosen) if (!names.includes(name)) names.push(name)
    return names
  }, [curriculum, chosen])

  const parsed = useMemo(() => parseTimetable(timetableText), [timetableText])
  const coachingStartMin = parseTimeValue(coachingStart)
  const coachingEndMin = parseTimeValue(coachingEnd)
  const keys = useMemo(() => subjectKeys(chosen), [chosen])

  /** A starting point to edit, not a timetable the app invents for them. */
  function fillTypicalWeek() {
    const generated = buildSchoolTimetable({
      subjects: chosen.map((name, index) => ({ key: keys[index]!, name })),
      days: days.length ? days : [0, 1, 2, 3, 4],
      start: 8 * 60,
      end: 14 * 60 + 30,
      periodLength: 45,
      breakAfter: 4,
      breakLength: 30,
    })
    const firstDay = days.length ? Math.min(...days) : 0
    const periods = generated.entries
      .filter((entry) => entry.day === firstDay && entry.kind === 'class')
      .map((entry) => ({
        startMin: entry.startMin,
        endMin: entry.endMin,
        subjectName: entry.title,
      }))
    setTimetableText(formatTimetable(periods))
  }

  function pickClass(level: number) {
    setError('')
    setClassLevel(level)
    const names = curriculumFor(level).map((subject) => subject.name)
    setChosen((current) => {
      const kept = current.filter((name) => names.includes(name))
      return kept.length ? kept : names.slice(0, 5)
    })
  }

  function toggleSubject(name: string) {
    setChosen((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    )
  }

  function toggleDay(day: number) {
    setDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort((a, b) => a - b),
    )
  }

  function patchTest(id: string, values: Partial<Test>) {
    setTests((current) =>
      current.map((test) => (test.id === id ? { ...test, ...values } : test)),
    )
  }

  function toggleTestSubject(id: string, name: string) {
    setTests((current) =>
      current.map((test) =>
        test.id === id
          ? {
              ...test,
              subjects: test.subjects.includes(name)
                ? test.subjects.filter((item) => item !== name)
                : [...test.subjects, name],
            }
          : test,
      ),
    )
  }

  async function build() {
    if (classLevel === null) {
      setError('Pick your class first.')
      setStep(0)
      return
    }
    if (!chosen.length) {
      setError('Pick at least one subject.')
      setStep(0)
      return
    }
    if (!days.length) {
      setError('Pick at least one school day.')
      setStep(1)
      return
    }
    if (parsed.errors.length) {
      setError(parsed.errors[0]!)
      setStep(1)
      return
    }
    if (!parsed.periods.length) {
      setError('Write at least one period of your school timetable.')
      setStep(1)
      return
    }
    const unknown = parsed.periods.find(
      (period) =>
        !chosen.some(
          (name) => name.toLowerCase() === period.subjectName.toLowerCase(),
        ),
    )
    if (unknown) {
      setError(
        `“${unknown.subjectName}” is not one of your subjects. Add it above, or fix that line of the timetable.`,
      )
      setStep(0)
      return
    }
    if (
      coachingOn &&
      (!coachingDays.length || coachingEndMin <= coachingStartMin)
    ) {
      setError('Choose the coaching days, and a finish time after the start.')
      setStep(1)
      return
    }
    setBusy(true)
    setError('')
    try {
      await applySetup(
        buildSetupPayload({
          classLevel,
          subjectNames: chosen,
          days,
          periods: parsed.periods,
          coaching: coachingOn
            ? {
                days: coachingDays,
                startMin: coachingStartMin,
                endMin: coachingEndMin,
              }
            : null,
          studyHours,
          tests: tests.map((test) => ({
            date: test.date,
            subjects: test.subjects,
          })),
          from: todayISO(),
        }),
      )
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your timetable.')
    } finally {
      setBusy(false)
    }
  }

  const examCount = tests.filter((test) => test.date && test.subjects.length).length

  return (
    <div className="wizard">
      <header className="wizard-head">
        <p className="eyebrow">Class setup · CBSE</p>
        <h2>Set up your class and school week.</h2>
        <p className="muted">
          Studydeck uses the NCERT chapter list for your class to suggest
          subjects, and the AI study desk follows the same syllabus. Nothing you
          enter is published or shared.
        </p>
      </header>

      <ol className="wizard-steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={
              index === step
                ? 'wizard-step active'
                : index < step
                  ? 'wizard-step done'
                  : 'wizard-step'
            }
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error ? <p className="error">{error}</p> : null}

      {step === 0 ? (
        <section className="card">
          <div className="card-head">
            <h3>Which class are you in?</h3>
            <span className="count">NCERT syllabus</span>
          </div>
          <div className="class-grid">
            {CLASS_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-label={`Class ${level}`}
                aria-pressed={level === classLevel}
                className={level === classLevel ? 'class-chip active' : 'class-chip'}
                onClick={() => pickClass(level)}
              >
                <strong>{level}</strong>
                <span>Class</span>
              </button>
            ))}
          </div>
          <div className="card-head subject-head">
            <h3>Your subjects</h3>
            <span className="count">
              {classLevel === null ? 'waiting for your class' : `${chosen.length} chosen`}
            </span>
          </div>
          {classLevel === null ? (
            <p className="muted small">
              Choose your class above and Studydeck will list that year’s NCERT
              subjects for you to tick.
            </p>
          ) : (
            <>
              <p className="muted small">
                Tick what you actually study. Class 11–12 students can pick a
                science or commerce set.
              </p>
              <div className="subject-tags">
                {options.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={chosen.includes(name) ? 'tag active' : 'tag'}
                    onClick={() => toggleSubject(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="card">
          <div className="card-head">
            <h3>Your school timetable</h3>
            <span className="count">
              {parsed.periods.length} period
              {parsed.periods.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="form-group">
            <span className="field-label">Days you have school</span>
            <div className="day-chips">
              {DAY_LONG.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={days.includes(index) ? 'tag active' : 'tag'}
                  onClick={() => toggleDay(index)}
                >
                  {label.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Your school timetable</span>
            <textarea
              className="timetable-text"
              value={timetableText}
              spellCheck={false}
              placeholder={'08:00-08:45 Mathematics\n08:45-09:30 Science'}
              onChange={(event) => setTimetableText(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={fillTypicalWeek}
            >
              Fill a typical week for me
            </button>
          </div>
          <p className="fineprint">
            {TIMETABLE_HINT} It is repeated on every school day you picked, and
            you can change a single day later in Timetable.
          </p>
          {parsed.errors.length ? (
            <ul className="error small">
              {parsed.errors.slice(0, 4).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <div className="day-section">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={coachingOn}
                onChange={(event) => setCoachingOn(event.target.checked)}
              />
              I go to coaching
            </label>
            {coachingOn ? (
              <>
                <div className="form-row">
                  <label className="field">
                    <span>Coaching starts</span>
                    <input
                      type="time"
                      value={coachingStart}
                      onChange={(event) => setCoachingStart(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Coaching ends</span>
                    <input
                      type="time"
                      value={coachingEnd}
                      onChange={(event) => setCoachingEnd(event.target.value)}
                    />
                  </label>
                </div>
                <div className="form-group">
                  <span className="field-label">Coaching days</span>
                  <div className="day-chips">
                    {DAY_LONG.map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        className={coachingDays.includes(index) ? 'tag active' : 'tag'}
                        onClick={() =>
                          setCoachingDays((current) =>
                            current.includes(index)
                              ? current.filter((day) => day !== index)
                              : [...current, index].sort((a, b) => a - b),
                          )
                        }
                      >
                        {label.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <label className="field">
            <span>Study hours outside school</span>
            <input
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={studyHours}
              onChange={(event) => setStudyHours(Number(event.target.value))}
            />
          </label>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card">
          <div className="card-head">
            <h3>Your tests and exams</h3>
            <button
              type="button"
              className="btn ghost small"
              onClick={() =>
                setTests((current) => [
                  ...current,
                  { id: crypto.randomUUID(), name: 'Test', date: '', subjects: [] },
                ])
              }
            >
              Add another
            </button>
          </div>
          <p className="muted small">
            Each test sets that subject’s exam date, which is how the revision
            plan knows what to prioritise. You can skip this and add dates later.
          </p>
          <div className="test-list">
            {tests.map((test) => (
              <div className="test-row" key={test.id}>
                <div className="form-row">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={test.name}
                      maxLength={40}
                      placeholder="Half-yearly"
                      onChange={(event) => patchTest(test.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={test.date}
                      min={todayISO()}
                      onChange={(event) => patchTest(test.id, { date: event.target.value })}
                    />
                  </label>
                </div>
                <div className="subject-tags">
                  {chosen.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={test.subjects.includes(name) ? 'tag active' : 'tag'}
                      onClick={() => toggleTestSubject(test.id, name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {tests.length > 1 ? (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() =>
                      setTests((current) => current.filter((item) => item.id !== test.id))
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="card">
          <div className="card-head">
            <h3>Here’s your week</h3>
            <span className="count">
              {parsed.periods.length} periods × {days.length} days
            </span>
          </div>
          <ul className="summary">
            <li>
              <strong>Class {classLevel}</strong> · {chosen.join(', ')}
            </li>
            <li>
              {parsed.periods.length} school period
              {parsed.periods.length === 1 ? '' : 's'} on{' '}
              {days.map((day) => DAY_LONG[day]!.slice(0, 3)).join(', ')}
              {coachingOn
                ? `, then coaching ${fmtTime(coachingStartMin)}–${fmtTime(coachingEndMin)} on ${
                    coachingDays.map((day) => DAY_LONG[day]!.slice(0, 3)).join(', ') ||
                    'no days yet'
                  }`
                : ''}
            </li>
            <li>
              {parsed.periods.length
                ? `${parsed.periods.length * days.length} school periods${coachingOn ? ' plus coaching' : ''} go on the timetable.`
                : 'No periods yet. Go back and write your timetable.'}
            </li>
            <li>
              {examCount
                ? `${examCount} test${examCount === 1 ? '' : 's'} will shape a revision plan at ${studyHours}h a day.`
                : 'No test dates yet. You can add them any time in the timetable.'}
            </li>
          </ul>
          <p className="fineprint">
            You can change every block afterwards. Re-running this setup rebuilds
            the timetable but keeps your notes and tasks.
          </p>
        </section>
      ) : null}

      <div className="wizard-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={step === 0 || busy}
          onClick={() => setStep((value) => Math.max(0, value - 1))}
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (step === 0 && classLevel === null) {
                setError('Pick your class to continue.')
                return
              }
              setError('')
              setStep((value) => value + 1)
            }}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void build()}
          >
            {busy ? 'Building your timetable…' : 'Build my timetable'}
          </button>
        )}
      </div>

      {existing ? (
        <section className="card">
          <div className="card-head">
            <h3>Your data</h3>
            <span className="count">Yours alone</span>
          </div>
          <p className="muted">
            Keep a copy of your subjects, timetable, tasks, notes, day check-ins
            (with their briefs) and library chats as one JSON file, or start
            again from an empty workspace.
          </p>
          <div className="form-actions">
            <a className="btn ghost" href="/api/export" download>
              Download a backup
            </a>
            <button
              type="button"
              className="btn ghost"
              disabled={deleting}
              onClick={() => void removeEverything()}
            >
              {deleting ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
          <p className="fineprint">
            Deleting removes your data from the server and cannot be undone.
            Your account itself stays, so you can build a new timetable straight
            away.
          </p>
        </section>
      ) : null}
    </div>
  )
}
