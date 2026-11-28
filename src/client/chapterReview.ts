import type { Subject, SyllabusTick } from '../shared/types'
import { daysBetween, isoOf } from './dates'

/**
 * Chapters a student ticked a week ago or more, ready for a short revisit.
 *
 * Ticking a chapter is not the same as remembering it, so each tick starts a
 * clock: after a week the chapter comes back on Today for ten minutes. Ticking
 * it again restarts the clock, which is how the same chapter keeps coming back
 * until its exam without any extra state to store.
 */

/** Days between sittings of the same chapter. */
export const REVISIT_AFTER_DAYS = 7

export type ChapterRevisit = {
  subjectId: string
  subjectName: string
  color: string
  chapter: string
  tickedAt: number
  /** The local day the chapter was ticked. */
  tickedOn: string
  /** Whole days since it was ticked. */
  daysSince: number
  /** Days until that subject's exam; null when it has no date ahead. */
  daysToExam: number | null
}

export function chapterRevisits({
  subjects,
  syllabus,
  today,
  afterDays = REVISIT_AFTER_DAYS,
}: {
  subjects: Subject[]
  syllabus: SyllabusTick[]
  today: string
  afterDays?: number
}): ChapterRevisit[] {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]))
  const rows: ChapterRevisit[] = []

  for (const tick of syllabus) {
    const subject = byId.get(tick.subjectId)
    // A tick whose subject is gone cannot be named or opened, so it is left.
    if (!subject) continue
    // Chapters whose exam has already happened have nothing left to revise for.
    if (subject.examDate && subject.examDate < today) continue
    if (typeof tick.tickedAt !== 'number' || !Number.isFinite(tick.tickedAt)) continue

    const tickedOn = isoOf(new Date(tick.tickedAt))
    const daysSince = daysBetween(tickedOn, today)
    if (daysSince < afterDays) continue

    rows.push({
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      chapter: tick.chapter,
      tickedAt: tick.tickedAt,
      tickedOn,
      daysSince,
      daysToExam:
        subject.examDate && subject.examDate >= today
          ? daysBetween(today, subject.examDate)
          : null,
    })
  }

  // The nearest exam is the deadline that matters; after that, the chapter
  // left alone longest comes first.
  return rows.sort(
    (a, b) =>
      (a.daysToExam ?? Number.POSITIVE_INFINITY) -
        (b.daysToExam ?? Number.POSITIVE_INFINITY) ||
      b.daysSince - a.daysSince ||
      a.chapter.localeCompare(b.chapter),
  )
}
