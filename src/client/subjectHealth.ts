import { unitsFor } from '../shared/curriculum'
import type {
  MistakeCount,
  Subject,
  SyllabusTick,
  Task,
} from '../shared/types'
import { daysBetween } from './dates'

/**
 * How far behind each subject is, and so where tonight's study should go.
 *
 * Four things count: chapters still to tick, work that is already late, how
 * little time is left before the exam, and the flashcards whose last answer
 * was Again. They are weighed into one score so the order does not change from
 * day to day. The Subject health page sorts by that score, the evening plan
 * spends its leftover time in the same order, and the revision plan shares each
 * day by it, so none of them can point at different subjects.
 */

export type HealthStatus = 'behind' | 'watch' | 'steady' | 'clear'

export type SubjectHealth = {
  subject: Subject
  chaptersTotal: number
  chaptersDone: number
  chaptersLeft: number
  /** Days to the exam; null with no date, or one that has already passed. */
  daysToExam: number | null
  /** Chapters a week to finish before the exam; null without an exam date. */
  pacePerWeek: number | null
  overdue: number
  openTasks: number
  /** Flashcards whose last answer was Again. */
  mistakes: number
  /** Higher means further behind. Shared with the evening plan. */
  score: number
  status: HealthStatus
}

type Weight = {
  chaptersLeft: number
  overdue: number
  daysToExam: number | null
  mistakes?: number
}

/** With no exam date, a subject is measured against two months of work. */
const HORIZON_WEEKS = 8
/** Inside a fortnight, unfinished chapters are an emergency, not a pace. */
const SHORT_RUN_DAYS = 14
const CRUNCH_DAYS = 7
/** Half a point for a card answered Again, so a subject that is not sticking
 * gets time even when its chapters are ticked — capped so a run of missed
 * flashcards cannot bury the exam deadline. */
const MISTAKE_POINTS = 0.5
const MAX_MISTAKE_POINTS = 2

const round1 = (value: number) => Math.round(value * 10) / 10

/** The weeks a subject has to finish in, never less than half a week. */
export const weeksUntil = (daysToExam: number | null) =>
  daysToExam === null ? HORIZON_WEEKS : Math.max(0.5, daysToExam / 7)

/**
 * A chapter a week, late work at double weight, and a flat penalty for
 * chapters still open in the last fortnight before the exam.
 */
export function behindScore({
  chaptersLeft,
  overdue,
  daysToExam,
  mistakes = 0,
}: Weight): number {
  const crunch =
    daysToExam !== null && daysToExam <= SHORT_RUN_DAYS && chaptersLeft > 0
      ? 3
      : 0
  const missed = Math.min(
    MAX_MISTAKE_POINTS,
    Math.max(0, mistakes) * MISTAKE_POINTS,
  )
  return round1(
    chaptersLeft / weeksUntil(daysToExam) + overdue * 2 + crunch + missed,
  )
}

export function healthStatus({
  chaptersLeft,
  overdue,
  daysToExam,
  mistakes = 0,
  score,
}: Weight & { score: number }): HealthStatus {
  if (!chaptersLeft && !overdue && !mistakes) return 'clear'
  if (
    overdue >= 2 ||
    score >= 4 ||
    (daysToExam !== null && daysToExam <= CRUNCH_DAYS && chaptersLeft > 0)
  )
    return 'behind'
  if (overdue > 0 || score >= 1.5) return 'watch'
  return 'steady'
}

/** Every subject, furthest behind first. */
export function subjectHealth({
  subjects,
  syllabus,
  tasks,
  classLevel,
  today,
  mistakes = [],
}: {
  subjects: Subject[]
  syllabus: SyllabusTick[]
  tasks: Task[]
  classLevel: number
  today: string
  /** Cards whose last answer was Again, per subject. */
  mistakes?: MistakeCount[]
}): SubjectHealth[] {
  const covered = new Set(
    syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`),
  )
  const missed = new Map(
    mistakes
      .filter((row) => row.subjectId)
      .map((row) => [row.subjectId as string, row.cards]),
  )

  const rows = subjects.map((subject) => {
    const chapters = unitsFor(classLevel, subject.name)
    const chaptersDone = chapters.filter((chapter) =>
      covered.has(`${subject.id}::${chapter}`),
    ).length
    const chaptersLeft = chapters.length - chaptersDone

    const daysToExam =
      subject.examDate && subject.examDate >= today
        ? daysBetween(today, subject.examDate)
        : null

    const open = tasks.filter(
      (task) => task.subjectId === subject.id && !task.done,
    )
    const overdue = open.filter((task) => task.dueDate && task.dueDate < today)
    const weight = {
      chaptersLeft,
      overdue: overdue.length,
      daysToExam,
      mistakes: missed.get(subject.id) ?? 0,
    }
    const score = behindScore(weight)

    return {
      subject,
      chaptersTotal: chapters.length,
      chaptersDone,
      chaptersLeft,
      daysToExam,
      pacePerWeek:
        daysToExam === null ? null : round1(chaptersLeft / weeksUntil(daysToExam)),
      overdue: overdue.length,
      openTasks: open.length,
      mistakes: weight.mistakes,
      score,
      status: healthStatus({ ...weight, score }),
    }
  })

  return rows.sort(
    (a, b) =>
      b.score - a.score ||
      (a.daysToExam ?? Number.POSITIVE_INFINITY) -
        (b.daysToExam ?? Number.POSITIVE_INFINITY) ||
      a.subject.name.localeCompare(b.subject.name),
  )
}

function paceText(pace: number): string {
  const value = pace >= 10 ? Math.round(pace) : round1(pace)
  return `${value} chapter${value === 1 ? '' : 's'} a week`
}

/** One line saying what makes this subject the weight it is. */
export function healthNote(row: SubjectHealth): string {
  const parts: string[] = []
  if (!row.chaptersTotal) parts.push('No chapter list for this subject yet')
  else if (!row.chaptersLeft)
    parts.push(`All ${row.chaptersTotal} chapters ticked`)
  else parts.push(`${row.chaptersLeft} of ${row.chaptersTotal} chapters left`)

  if (row.daysToExam === null)
    parts.push(row.subject.examDate ? 'exam date has passed' : 'no exam date')
  else if (row.daysToExam === 0) parts.push('exam today')
  else if (row.daysToExam === 1) parts.push('exam tomorrow')
  else parts.push(`exam in ${row.daysToExam} days`)

  if (row.overdue === 1) parts.push('1 overdue task')
  else if (row.overdue > 1) parts.push(`${row.overdue} overdue tasks`)

  if (row.mistakes === 1) parts.push('1 missed card')
  else if (row.mistakes > 1) parts.push(`${row.mistakes} missed cards`)

  if (row.pacePerWeek !== null && row.chaptersLeft > 0)
    parts.push(`${paceText(row.pacePerWeek)} to finish`)

  return parts.join(' · ')
}
