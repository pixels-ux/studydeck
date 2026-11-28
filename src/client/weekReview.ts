import type { DayLog, Entry, Subject } from '../shared/types'
import { addDays } from './dates'

/**
 * The week in review: the revision study the timetable planned for the last
 * seven finished evenings, set against the day check-ins that were actually
 * saved. An evening with blocks and no check-in is one the student never
 * confirmed, so its subjects count as skipped — and the subjects that keep
 * landing on those evenings are the ones they keep skipping.
 *
 * Today is left out: tonight has not happened yet, so it cannot be skipped.
 */

export const REVIEW_NIGHTS = 7
const GENERAL_COLOR = '#5f6d5f'

export type WeekNight = {
  date: string
  plannedMinutes: number
  checkedIn: boolean
}

export type WeekSubject = {
  subjectId: string | null
  name: string
  color: string
  /** Evenings with at least one block for this subject. */
  eveningsPlanned: number
  /** Of those, the evenings a check-in was saved. */
  eveningsCheckedIn: number
  plannedMinutes: number
  /** Minutes on the evenings that were never checked in. */
  skippedMinutes: number
}

export type WeekReview = {
  /** First and last evening counted, YYYY-MM-DD. */
  from: string
  to: string
  nights: WeekNight[]
  /** Evenings that had revision study planned. */
  plannedNights: number
  /** Of those, the evenings a check-in was saved for. */
  checkedInNights: number
  /** Every evening with a saved check-in, plan or not. */
  loggedNights: number
  plannedMinutes: number
  skippedMinutes: number
  /** Subjects with skipped minutes, worst first. */
  subjects: WeekSubject[]
  worst: WeekSubject | null
}

export function weekReview({
  entries,
  logs,
  subjects,
  today,
  nights = REVIEW_NIGHTS,
}: {
  entries: Entry[]
  logs: Pick<DayLog, 'date'>[]
  subjects: Subject[]
  today: string
  nights?: number
}): WeekReview {
  const dates = Array.from({ length: nights }, (_, index) =>
    addDays(today, index - nights),
  )
  const logged = new Set(logs.map((log) => log.date))
  const rows = new Map<string, WeekSubject>()
  const review: WeekReview = {
    from: dates[0] ?? today,
    to: dates[dates.length - 1] ?? today,
    nights: [],
    plannedNights: 0,
    checkedInNights: 0,
    loggedNights: 0,
    plannedMinutes: 0,
    skippedMinutes: 0,
    subjects: [],
    worst: null,
  }

  for (const date of dates) {
    const blocks = entries.filter(
      (entry) =>
        entry.plan === 'intensive' &&
        entry.kind === 'study' &&
        entry.date === date,
    )
    const minutes = blocks.reduce(
      (sum, entry) => sum + Math.max(0, entry.endMin - entry.startMin),
      0,
    )
    const checkedIn = logged.has(date)
    review.nights.push({ date, plannedMinutes: minutes, checkedIn })
    if (minutes) review.plannedNights += 1
    if (checkedIn) review.loggedNights += 1
    if (minutes && checkedIn) review.checkedInNights += 1
    review.plannedMinutes += minutes

    const bySubject = new Map<string | null, number>()
    for (const block of blocks) {
      const found = bySubject.get(block.subjectId) ?? 0
      bySubject.set(
        block.subjectId,
        found + Math.max(0, block.endMin - block.startMin),
      )
    }

    for (const [subjectId, planned] of bySubject) {
      const key = subjectId ?? 'general'
      const subject = subjectId
        ? subjects.find((item) => item.id === subjectId)
        : undefined
      const row =
        rows.get(key) ??
        ({
          subjectId,
          name: subject?.name ?? 'General',
          color: subject?.color ?? GENERAL_COLOR,
          eveningsPlanned: 0,
          eveningsCheckedIn: 0,
          plannedMinutes: 0,
          skippedMinutes: 0,
        } satisfies WeekSubject)
      row.eveningsPlanned += 1
      row.plannedMinutes += planned
      if (checkedIn) row.eveningsCheckedIn += 1
      else {
        row.skippedMinutes += planned
        review.skippedMinutes += planned
      }
      rows.set(key, row)
    }
  }

  review.subjects = [...rows.values()]
    .filter((row) => row.skippedMinutes > 0)
    .sort(
      (a, b) =>
        b.skippedMinutes - a.skippedMinutes ||
        b.eveningsPlanned - a.eveningsPlanned ||
        a.name.localeCompare(b.name),
    )
  review.worst = review.subjects[0] ?? null
  return review
}
