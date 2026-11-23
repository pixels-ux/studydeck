import { useEffect, useMemo, useState } from 'react'
import { unitsFor } from '../shared/curriculum'
import type {
  DayCoaching,
  DayCovered,
  DayHomework,
  DayLog,
  Entry,
  HomeworkSource,
} from '../shared/types'
import { api } from './api'
import { fmtDuration, fmtTime, minutesNow, parseTimeValue, toTimeValue, todayISO } from './dates'
import { backlogOf, buildEveningPlan, type Backlog } from './dayPlan'
import Prose from './Prose'
import { useWorkspace } from './workspace'

type DayResponse = {
  date: string
  log: DayLog | null
  classes: Entry[]
  coaching: Entry | null
}

const STEPS = ['School', 'Coaching', 'Homework', 'Tonight']

const roundUp = (minutes: number, step = 15) =>
  Math.ceil(minutes / step) * step

function defaultFreeFrom(classes: Entry[], coaching: Entry | null): number {
  const last = [...classes, ...(coaching ? [coaching] : [])]
    .filter((entry) => entry.kind !== 'break')
    .reduce((latest, entry) => Math.max(latest, entry.endMin), 0)
  const base = Math.max(last, minutesNow())
  return Math.min(roundUp(base + 30), 22 * 60)
}

export default function DayCheckin() {
  const { data, replaceDayPlan, setAiRemaining } = useWorkspace()
  const today = todayISO()

  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [classes, setClasses] = useState<Entry[]>([])
  const [coachingEntry, setCoachingEntry] = useState<Entry | null>(null)
  const [school, setSchool] = useState<DayCovered[]>([])
  const [coachingOn, setCoachingOn] = useState(false)
  const [coaching, setCoaching] = useState<DayCoaching>({
    attending: true,
    startMin: 16 * 60,
    endMin: 17 * 60 + 30,
    topic: '',
  })
  const [homework, setHomework] = useState<DayHomework[]>([])
  const [freeFrom, setFreeFrom] = useState(16 * 60)
  const [freeUntil, setFreeUntil] = useState(22 * 60)
  const [brief, setBrief] = useState('')
  const [briefBusy, setBriefBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'

  useEffect(() => {
    let alive = true
    api<DayResponse>(`/api/day?date=${today}`)
      .then((result) => {
        if (!alive) return
        setClasses(result.classes)
        setCoachingEntry(result.coaching)
        const log = result.log
        if (log) {
          // An empty list is a real answer ("no school today"), not a gap.
          setSchool(log.school)
          setHomework(log.homework)
          setFreeFrom(log.freeFrom)
          setFreeUntil(log.freeUntil)
          setBrief(log.brief)
          if (log.coaching) {
            setCoachingOn(log.coaching.attending)
            setCoaching(log.coaching)
          } else if (result.coaching) {
            setCoachingOn(true)
            setCoaching({
              attending: true,
              startMin: result.coaching.startMin,
              endMin: result.coaching.endMin,
              topic: '',
            })
          }
        } else {
          setSchool(
            result.classes.map((entry) => ({
              subjectId: entry.subjectId,
              title: entry.title,
              topic: '',
            })),
          )
          setFreeFrom(defaultFreeFrom(result.classes, result.coaching))
          setFreeUntil(22 * 60)
          if (result.coaching) {
            setCoachingOn(true)
            setCoaching({
              attending: true,
              startMin: result.coaching.startMin,
              endMin: result.coaching.endMin,
              topic: '',
            })
          }
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Could not load your day.'),
      )
      .finally(() => setLoading(false))
    return () => {
      alive = false
    }
  }, [today])

  const backlog = useMemo<Backlog>(() => {
    const classLevel = data.profile?.classLevel ?? 10
    const ticked = new Set(
      data.syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`),
    )
    const subjects = data.subjects.map((subject) => {
      const chapters = unitsFor(classLevel, subject.name)
      return {
        id: subject.id,
        name: subject.name,
        examDate: subject.examDate,
        chaptersTotal: chapters.length,
        chaptersDone: chapters.filter((chapter) =>
          ticked.has(`${subject.id}::${chapter}`),
        ).length,
      }
    })
    return backlogOf({
      tasks: data.tasks,
      today,
      subjects,
      chaptersLeft: subjects.reduce(
        (sum, subject) =>
          sum + Math.max(0, subject.chaptersTotal - subject.chaptersDone),
        0,
      ),
    })
  }, [data.profile, data.syllabus, data.subjects, data.tasks, today])

  const covered = useMemo(
    () =>
      coachingOn && coaching.topic.trim()
        ? [
            ...school,
            { subjectId: null, title: 'Coaching', topic: coaching.topic },
          ]
        : school,
    [school, coachingOn, coaching.topic],
  )

  const plan = useMemo(
    () =>
      buildEveningPlan({
        date: today,
        freeFrom,
        freeUntil,
        homework: homework.filter((item) => item.title.trim()),
        covered,
        backlog,
      }),
    [today, freeFrom, freeUntil, homework, covered, backlog],
  )

  const savedPlan = data.entries
    .filter((entry) => entry.plan === 'intensive' && entry.date === today)
    .sort((a, b) => a.startMin - b.startMin)

  const homeworkFor = (source: HomeworkSource) =>
    homework.filter((item) => item.source === source)
  const homeworkMinutes = homework.reduce((sum, item) => sum + item.minutes, 0)

  function setTopic(index: number, topic: string) {
    setSchool((current) =>
      current.map((item, at) => (at === index ? { ...item, topic } : item)),
    )
  }

  function addHomework(source: HomeworkSource) {
    setHomework((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        subjectId: null,
        source,
        title: '',
        minutes: 40,
      },
    ])
  }

  function patchHomework(id: string, values: Partial<DayHomework>) {
    setHomework((current) =>
      current.map((item) => (item.id === id ? { ...item, ...values } : item)),
    )
  }

  function clearHomework(source: HomeworkSource) {
    setHomework((current) => current.filter((item) => item.source !== source))
  }

  async function save() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api<{ log: DayLog }>('/api/day', {
        method: 'PUT',
        body: {
          date: today,
          school,
          coaching: coachingOn ? { ...coaching, attending: coachingOn } : null,
          homework: homework.filter(
            (item) => item.title.trim() && item.minutes > 0,
          ),
          freeFrom,
          freeUntil,
          brief,
        },
      })
      await replaceDayPlan(today, plan.entries)
      setNotice(
        plan.entries.length
          ? `Tonight’s plan is on your timetable, ${fmtTime(plan.entries[0]!.startMin)} to ${fmtTime(plan.entries.at(-1)!.endMin)}.`
          : 'Your day is saved. There was no room left for study blocks.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your day.')
    } finally {
      setSaving(false)
    }
  }

  async function askBrief() {
    setBriefBusy(true)
    setError('')
    try {
      const result = await api<{ brief: string; remaining: number }>(
        '/api/day/brief',
        { method: 'POST', body: { date: today } },
      )
      setBrief(result.brief)
      setAiRemaining(result.remaining)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the brief.')
    } finally {
      setBriefBusy(false)
    }
  }

  if (loading)
    return (
      <section className="card">
        <p className="muted small">Reading your timetable…</p>
      </section>
    )

  return (
    <section className="card day-card">
      <div className="card-head">
        <h3>Check in your day</h3>
        <span className="count">
          {classes.length} school period{classes.length === 1 ? '' : 's'}
          {coachingEntry ? ' · coaching' : ''}
        </span>
      </div>
      <p className="muted">
        Say what was actually taught, what homework was set and when you are free.
        Studydeck builds the evening around it, with breaks that match how heavy
        the day was.
      </p>

      <ol className="wizard-steps day-steps">
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

      {error ? <p className="error small">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      {step === 0 ? (
        <div className="day-section">
          <div className="card-head">
            <h4>What was done in school?</h4>
            {school.length ? (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setSchool([])}
              >
                No school today
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost small"
                onClick={() =>
                  setSchool(
                    classes.map((entry) => ({
                      subjectId: entry.subjectId,
                      title: entry.title,
                      topic: '',
                    })),
                  )
                }
              >
                Add today’s periods
              </button>
            )}
          </div>
          {school.length === 0 ? (
            <p className="empty-line">
              No school today. Coaching and homework still count.
            </p>
          ) : (
            <ul className="topic-list">
              {school.map((item, index) => (
                <li key={`${item.title}-${index}`} className="topic-row">
                  <span className="topic-name">{item.title}</span>
                  <input
                    value={item.topic}
                    maxLength={300}
                    placeholder="Topic taught, e.g. Refraction through a prism"
                    aria-label={`What was taught in ${item.title}`}
                    onChange={(event) => setTopic(index, event.target.value)}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="fineprint">
            Leave a period blank if it was free or the teacher was absent. These
            topics become short review blocks tonight.
          </p>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="day-section">
          <div className="card-head">
            <h4>Coaching today</h4>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={coachingOn}
                onChange={(event) => {
                  setCoachingOn(event.target.checked)
                  setCoaching((current) => ({
                    ...current,
                    attending: event.target.checked,
                  }))
                }}
              />
              I have coaching
            </label>
          </div>
          {coachingOn ? (
            <>
              <div className="form-row">
                <label className="field">
                  <span>Starts</span>
                  <input
                    type="time"
                    value={toTimeValue(coaching.startMin)}
                    onChange={(event) =>
                      setCoaching((current) => ({
                        ...current,
                        startMin: parseTimeValue(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input
                    type="time"
                    value={toTimeValue(coaching.endMin)}
                    onChange={(event) =>
                      setCoaching((current) => ({
                        ...current,
                        endMin: parseTimeValue(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>What was done there</span>
                <textarea
                  className="short-body"
                  value={coaching.topic}
                  maxLength={300}
                  placeholder="Chapter and questions solved"
                  onChange={(event) =>
                    setCoaching((current) => ({
                      ...current,
                      topic: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          ) : (
            <p className="empty-line">
              No coaching. Your evening starts earlier.
            </p>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="day-section">
          {(['school', 'coaching'] as const).map((source) => (
            <div key={source} className="homework-group">
              <div className="card-head">
                <h4>{source === 'school' ? 'School homework' : 'Coaching homework'}</h4>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => clearHomework(source)}
                  >
                    No {source} homework
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => addHomework(source)}
                  >
                    Add task
                  </button>
                </div>
              </div>
              {homeworkFor(source).length === 0 ? (
                <p className="empty-line">Nothing set here.</p>
              ) : (
                <ul className="homework-list">
                  {homeworkFor(source).map((item) => (
                    <li key={item.id} className="homework-row">
                      <select
                        value={item.subjectId ?? ''}
                        aria-label="Homework subject"
                        onChange={(event) =>
                          patchHomework(item.id, {
                            subjectId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">General</option>
                        {data.subjects.map((subject) => (
                          <option key={subject.id} value={subject.id}>
                            {subject.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={item.title}
                        maxLength={120}
                        placeholder="What is the task?"
                        aria-label="Homework task"
                        onChange={(event) =>
                          patchHomework(item.id, { title: event.target.value })
                        }
                      />
                      <label className="minutes">
                        <input
                          type="number"
                          min={0}
                          max={600}
                          step={5}
                          value={item.minutes}
                          aria-label="Minutes of work"
                          onChange={(event) =>
                            patchHomework(item.id, {
                              minutes: Number(event.target.value),
                            })
                          }
                        />
                        min
                      </label>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() =>
                          setHomework((current) =>
                            current.filter((entry) => entry.id !== item.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <p className="fineprint">
            {homeworkMinutes
              ? `${fmtDuration(homeworkMinutes)} of homework is planned into tonight, split into blocks you can sit through.`
              : 'No homework: the evening plan goes straight to the subjects you are behind in.'}
          </p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="day-section">
          <div className="form-row">
            <label className="field">
              <span>Free from</span>
              <input
                type="time"
                value={toTimeValue(freeFrom)}
                onChange={(event) => setFreeFrom(parseTimeValue(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Stop by</span>
              <input
                type="time"
                value={toTimeValue(freeUntil)}
                onChange={(event) => setFreeUntil(parseTimeValue(event.target.value))}
              />
            </label>
          </div>

          <div className="plan-summary">
            <p>
              <strong>{plan.studyMinutes}</strong> minutes of study,{' '}
              <strong>{plan.breakLength}</strong> minute breaks
              {plan.missedHomeworkMinutes
                ? ` · ${plan.missedHomeworkMinutes} minutes of homework does not fit`
                : ''}
            </p>
            <p className="muted small">
              {backlog.overdueTasks
                ? `${backlog.overdueTasks} overdue task${backlog.overdueTasks === 1 ? '' : 's'}`
                : 'Nothing overdue'}
              {' · '}
              {backlog.chaptersLeft} chapter{backlog.chaptersLeft === 1 ? '' : 's'} not ticked
              {backlog.nearestExamInDays === null
                ? ''
                : ` · exam in ${backlog.nearestExamInDays} day${backlog.nearestExamInDays === 1 ? '' : 's'}`}
            </p>
          </div>

          {plan.entries.length === 0 ? (
            <p className="empty-line">
              No room in that window. Free up at least 15 minutes, or move “free
              from” earlier.
            </p>
          ) : (
            <ul className="agenda">
              {plan.entries.map((entry, index) => (
                <li
                  key={`${entry.title}-${index}`}
                  className={entry.kind === 'break' ? 'agenda-row quiet' : 'agenda-row'}
                >
                  <span className="agenda-time">{fmtTime(entry.startMin)}</span>
                  <span
                    className="agenda-bar"
                    style={{
                      background:
                        entry.kind === 'break'
                          ? '#cfd8c8'
                          : data.subjects.find(
                              (subject) => subject.id === entry.subjectId,
                            )?.color ?? '#5f6d5f',
                    }}
                  />
                  <span className="agenda-main">
                    <strong>{entry.title}</strong>
                    <span className="muted">
                      {fmtDuration(entry.endMin - entry.startMin)} ·{' '}
                      {fmtTime(entry.endMin)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="form-actions">
            <button
              className="btn primary"
              disabled={saving || plan.entries.length === 0}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save and build tonight’s plan'}
            </button>
            {data.ai.enabled ? (
              <button
                type="button"
                className="btn ghost"
                disabled={briefBusy}
                onClick={() => void askBrief()}
              >
                {briefBusy ? 'Thinking…' : 'Ask AI about today'}
              </button>
            ) : null}
          </div>

          {brief ? (
            <div className="ai-answer">
              <Prose text={brief} />
            </div>
          ) : null}
          {savedPlan.length ? (
            <p className="fineprint">
              Your timetable now holds {savedPlan.length} block
              {savedPlan.length === 1 ? '' : 's'} for today.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="wizard-actions day-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={step === 0 || saving}
          onClick={() => setStep((value) => Math.max(0, value - 1))}
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setError('')
              setStep((value) => value + 1)
            }}
          >
            Continue
          </button>
        ) : null}
      </div>
    </section>
  )
}
