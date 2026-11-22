import type { EntryInput } from '../shared/types'

export type SchoolInput = {
  subjects: { key: string; name: string }[]
  days: number[]
  /** Minutes from midnight. */
  start: number
  end: number
  periodLength: number
  breakAfter: number
  breakLength: number
}

export type SchoolPlan = {
  entries: EntryInput[]
  periods: number
}

/**
 * Lays the chosen subjects across the school week: one period per slot, a
 * changeover between periods, a break after the configured period, and a
 * different starting subject each day so the week does not repeat itself.
 */
export function buildSchoolTimetable({
  subjects,
  days,
  start,
  end,
  periodLength,
  breakAfter,
  breakLength,
}: SchoolInput): SchoolPlan {
  if (!subjects.length || !days.length || end <= start)
    return { entries: [], periods: 0 }

  const step = periodLength + 5
  const periods = Math.max(
    1,
    Math.min(12, Math.floor((end - start - breakLength) / step)),
  )
  const entries: EntryInput[] = []

  ;[...days]
    .sort((a, b) => a - b)
    .forEach((day, dayIndex) => {
      const offset = dayIndex % subjects.length
      let clock = start
      for (let period = 0; period < periods; period += 1) {
        if (period === breakAfter && breakLength > 0) {
          entries.push({
            subjectId: null,
            title: 'Break',
            kind: 'break',
            plan: 'regular',
            day,
            startMin: clock,
            endMin: Math.min(clock + breakLength, end),
            room: '',
            date: '',
          })
          clock += breakLength
        }
        const subject = subjects[(offset + period) % subjects.length]!
        entries.push({
          subjectId: subject.key,
          title: subject.name,
          kind: 'class',
          plan: 'regular',
          day,
          startMin: clock,
          endMin: Math.min(clock + periodLength, end),
          room: '',
          date: '',
        })
        clock += step
      }
    })

  return {
    entries: entries.filter((entry) => entry.endMin > entry.startMin),
    periods,
  }
}

/** Earliest test date per subject, used as that subject's exam date. */
export function examDatesFromTests(
  subjects: { key: string; name: string }[],
  tests: { date: string; subjectNames: string[] }[],
): Record<string, string> {
  const keyByName = new Map(
    subjects.map((subject) => [subject.name.toLowerCase(), subject.key]),
  )
  const dates: Record<string, string> = {}
  for (const test of tests) {
    if (!test.date) continue
    for (const name of test.subjectNames) {
      const key = keyByName.get(name.toLowerCase())
      if (!key) continue
      if (!dates[key] || test.date < dates[key]!) dates[key] = test.date
    }
  }
  return dates
}
