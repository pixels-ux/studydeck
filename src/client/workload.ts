import { weeksUntil, type SubjectHealth } from './subjectHealth'

/**
 * Whether the chapters left can be finished in the study hours the student
 * set. Every subject's remaining chapters are priced at an hour of study and
 * spread over the weeks until its own exam (or eight weeks when it has none),
 * which gives the hours a week the work needs. Comparing that with the hours a
 * week the student actually has says whether the load fits before exam week.
 */

/** An hour of study is a fair price for revising one chapter with its questions. */
export const CHAPTER_MINUTES = 60

export type WorkloadVerdict = 'clear' | 'fits' | 'tight' | 'over'

export type Workload = {
  /** Minutes a week the study hours add up to. */
  weeklyMinutes: number
  /** Minutes a week the chapters left need to be finished on time. */
  neededWeeklyMinutes: number
  /** Chapters left across every subject. */
  chaptersLeft: number
  /** Hours of study those chapters are worth. */
  hoursToCover: number
  /** Weekly hours spare (positive) or short (negative), to the half hour. */
  gapHours: number
  verdict: WorkloadVerdict
  /** The earliest exam among subjects that still have chapters left, or "". */
  firstExamDate: string
  firstExamDays: number | null
  /** The subject needing the most study a week, which will slip first. */
  tightest: {
    name: string
    chaptersLeft: number
    weeks: number
    weeklyMinutes: number
  } | null
}

/** The half hour a gap is rounded to, so the figures read like a student's plan. */
const roundHalf = (value: number) => Math.round(value * 2) / 2
const round1 = (value: number) => Math.round(value * 10) / 10

export function workloadCheck({
  health,
  studyHours,
  daysPerWeek = 7,
}: {
  health: SubjectHealth[]
  studyHours: number
  daysPerWeek?: number
}): Workload {
  const days = Math.min(7, Math.max(1, Math.round(daysPerWeek)))
  const weeklyMinutes = Math.round(Math.max(0, studyHours) * 60 * days)

  let chaptersLeft = 0
  let needed = 0
  let firstExamDate = ''
  let firstExamDays: number | null = null
  let tightest: Workload['tightest'] = null

  for (const row of health) {
    chaptersLeft += row.chaptersLeft
    if (!row.chaptersLeft) continue
    const weeks = weeksUntil(row.daysToExam)
    const weekly = (row.chaptersLeft * CHAPTER_MINUTES) / weeks
    needed += weekly
    if (!tightest || weekly > tightest.weeklyMinutes)
      tightest = {
        name: row.subject.name,
        chaptersLeft: row.chaptersLeft,
        weeks: round1(weeks),
        weeklyMinutes: Math.round(weekly),
      }
    if (
      row.daysToExam !== null &&
      row.subject.examDate &&
      (!firstExamDate || row.subject.examDate < firstExamDate)
    ) {
      firstExamDate = row.subject.examDate
      firstExamDays = row.daysToExam
    }
  }

  // Within a sixth of the hours set is close enough to call tight, because one
  // missed evening is all it takes to fall behind at that margin.
  const ratio =
    needed === 0 ? 0 : weeklyMinutes === 0 ? Number.POSITIVE_INFINITY : needed / weeklyMinutes
  const verdict: WorkloadVerdict =
    chaptersLeft === 0
      ? 'clear'
      : ratio <= 0.85
        ? 'fits'
        : ratio <= 1.1
          ? 'tight'
          : 'over'

  return {
    weeklyMinutes,
    neededWeeklyMinutes: Math.round(needed),
    chaptersLeft,
    hoursToCover: round1((chaptersLeft * CHAPTER_MINUTES) / 60),
    gapHours: roundHalf((weeklyMinutes - needed) / 60),
    verdict,
    firstExamDate,
    firstExamDays,
    tightest,
  }
}
