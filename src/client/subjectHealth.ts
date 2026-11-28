import { unitsFor } from '../shared/curriculum'
import type { Subject, SyllabusTick, Task } from '../shared/types'
import { daysBetween } from './dates'

/**
 * How far behind each subject is, and so where tonight's study should go.
 *
 * Three things count: chapters still to tick, work that is already late, and
 * how little time is left before the exam. They are weighed into one score so
 * the order does not change from day to day: chapters a week until the exam
 * when a date is set, or over the next two months when it is not.
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
  /** Higher means further behind. Used for ordering, not shown as a number. */
  score: number
  status: HealthStatus
}

/** With no exam date, a subject is measured against two months of work. */
const HORIZON_WEEKS = 8
/** Inside a fortnight, unfinished chapters are an emergency, not a pace. */
const SHORT_RUN_DAYS = 14
const CRUNCH_DAYS = 7

const round1 = (value: number) => Math.round(value * 10) / 10

function statusOf({
  chaptersLeft,
  overdue,
  daysToExam,
  score,
}: {
  chaptersLeft: number
  overdue: number
  daysToExam: number | null
  score: number
}): HealthStatus {
  if (!chaptersLeft && !overdue) return 'clear'
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
}: {
  subjects: Subject[]
  syllabus: SyllabusTick[]
  tasks: Task[]
  classLevel: number
  today: string
}): SubjectHealth[] {
  const covered = new Set(
    syllabus.map((tick) => `${tick.subjectId}::${tick.chapter}`),
  )

  const rows = subjects.map((subject) => {
    const chapters = unitsFor(classLevel, subject.name)
    const done = chapters.filter((chapter) =>
      covered.has(`${subject.id}::${chapter}`),
    ).length
    const chaptersLeft = chapters.length - done

    const distance =
      subject.examDate && subject.examDate >= today
        ? daysBetween(today, subject.examDate)
        : null
    const daysToExam = distance !== null && distance >= 0 ? distance : null
    const weeksLeft =
      daysToExam === null ? HORIZON_WEEKS : Math.max(0.5, daysToExam / 7)
    const pacePerWeek =
      daysToExam === null ? null : round1(chaptersLeft / weeksLeft)

    const mine = tasks.filter((task) => task.subjectId === subject.id)
    const open = mine.filter((task) => !task.done)
    const overdue = open.filter((task) => task.dueDate && task.dueDate < today)

    // A chapter a week, plus late work at double weight, plus a flat penalty
    // for chapters still open this close to the exam.
    const crunch =
      daysToExam !== null && daysToExam <= SHORT_RUN_DAYS && chaptersLeft > 0
        ? 3
        : 0
    const score = round1(chaptersLeft / weeksLeft + overdue.length * 2 + crunch)

    return {
      subject,
      chaptersTotal: chapters.length,
      chaptersDone: done,
      chaptersLeft,
      daysToExam,
      pacePerWeek,
      overdue: overdue.length,
      openTasks: open.length,
      score,
      status: statusOf({
        chaptersLeft,
        overdue: overdue.length,
        daysToExam,
        score,
      }),
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
  else
    parts.push(
      `${row.chaptersLeft} of ${row.chaptersTotal} chapters left`,
    )

  if (row.daysToExam === null)
    parts.push(row.subject.examDate ? 'exam date has passed' : 'no exam date')
  else if (row.daysToExam === 0) parts.push('exam today')
  else if (row.daysToExam === 1) parts.push('exam tomorrow')
  else parts.push(`exam in ${row.daysToExam} days`)

  if (row.overdue === 1) parts.push('1 overdue task')
  else if (row.overdue > 1) parts.push(`${row.overdue} overdue tasks`)

  if (row.pacePerWeek !== null && row.chaptersLeft > 0)
    parts.push(`${paceText(row.pacePerWeek)} to finish`)

  return parts.join(' · ')
}
