import { useMemo, useState } from 'react'
import { CLASS_LEVELS, curriculumFor } from '../shared/curriculum'
import { api } from './api'
import {
  DAY_LONG,
  fmtDuration,
  fmtTime,
  parseTimeValue,
  toTimeValue,
  todayISO,
} from './dates'
import { buildSchoolTimetable } from './schoolTimetable'
import { buildSetupPayload, subjectKeys } from './setupPayload'
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
  const [schoolStart, setSchoolStart] = useState(
    toTimeValue(existing?.schoolStart ?? 8 * 60),
  )
  const [schoolEnd, setSchoolEnd] = useState(
    toTimeValue(existing?.schoolEnd ?? 14 * 60 + 30),
  )
  const [periodLength, setPeriodLength] = useState(existing?.periodLength ?? 45)
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

  const start = parseTimeValue(schoolStart)
  const end = parseTimeValue(schoolEnd)
  // The same keys are used for the preview and the saved payload, so the
  // generated blocks can be submitted unchanged.
  const keys = useMemo(() => subjectKeys(chosen), [chosen])
  const school = useMemo(
    () =>
      buildSchoolTimetable({
        subjects: chosen.map((name, index) => ({ key: keys[index]!, name })),
        days,
        start,
        end,
        periodLength,
        breakAfter: 4,
        breakLength: 30,
      }),
    [chosen, keys, days, start, end, periodLength],
  )

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
    if (end <= start) {
      setError('The school day must finish after it starts.')
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
          start,
          end,
          periodLength,
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
            <h3>Your school day</h3>
            <span className="count">{school.periods} periods</span>
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
          <div className="form-row">
            <label className="field">
              <span>School starts</span>
              <input
                type="time"
                value={schoolStart}
                onChange={(event) => setSchoolStart(event.target.value)}
              />
            </label>
            <label className="field">
              <span>School ends</span>
              <input
                type="time"
                value={schoolEnd}
                onChange={(event) => setSchoolEnd(event.target.value)}
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Period length</span>
              <select
                value={periodLength}
                onChange={(event) => setPeriodLength(Number(event.target.value))}
              >
                {[30, 35, 40, 45, 50, 55, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
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
          </div>
          <p className="fineprint">
            {school.periods > 0
              ? `${school.periods} periods of ${periodLength} minutes and a 30-minute break after period 4, ${fmtDuration(end - start)} at school.`
              : 'Check the school hours.'}
          </p>
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
              {school.periods} periods × {days.length} days
            </span>
          </div>
          <ul className="summary">
            <li>
              <strong>Class {classLevel}</strong> · {chosen.join(', ')}
            </li>
            <li>
              School {fmtTime(start)}–{fmtTime(end)}, {periodLength}-minute periods
              on {days.map((day) => DAY_LONG[day]!.slice(0, 3)).join(', ')}
            </li>
            <li>
              {school.periods > 0
                ? `${school.periods * days.length} class periods generated, plus a daily break.`
                : 'No periods yet. Go back and set your school hours.'}
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
            Keep a copy of your subjects, timetable, tasks and notes as one JSON
            file, or start again from an empty workspace.
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
