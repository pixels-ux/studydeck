import type { Entry, EntryInput, Subject } from '../shared/types'
import { addDays, dayIndexOf, daysBetween, minutesNow, todayISO } from './dates'

export type PlanRequest = {
  subjects: Subject[]
  regular: Entry[]
  from: string
  hoursPerDay: number
  includeWeekends: boolean
}

export type PlanResult = {
  entries: EntryInput[]
  sessions: number
  days: number
  error?: string
}

type Window = { start: number; end: number }

const SESSION = 50
const GAP = 10
const MIN_SESSION = 25
const DAY_START = 9 * 60
const DAY_END = 21 * 60

/** Gaps of at least 40 minutes between busy blocks inside the waking window. */
function freeWindows(busy: Window[], from: number, to: number): Window[] {
  const merged: Window[] = []
  for (const block of [...busy].sort((a, b) => a.start - b.start)) {
    const start = Math.max(from, block.start)
    const end = Math.min(to, block.end)
    if (end <= start) continue
    const last = merged[merged.length - 1]
    if (last && start <= last.end) last.end = Math.max(last.end, end)
    else merged.push({ start, end })
  }
  const gaps: Window[] = []
  let cursor = from
  for (const block of merged) {
    if (block.start - cursor >= 40) gaps.push({ start: cursor, end: block.start })
    cursor = Math.max(cursor, block.end)
  }
  if (to - cursor >= 40) gaps.push({ start: cursor, end: to })
  return gaps
}

/** Splits a day's study budget into sessions, keeping the leftover as one. */
function sessionLengths(budget: number): number[] {
  const slots: number[] = []
  let left = budget
  while (left >= SESSION) {
    slots.push(SESSION)
    left -= SESSION
  }
  if (left >= MIN_SESSION) slots.push(left)
  return slots
}

/**
 * Builds a revision timetable from exam dates and the student's real week.
 * Sessions never land on a class or in hours that have already passed, and
 * the subject with the nearest exam gets the largest share of each day.
 */
export function buildRevisionPlan({
  subjects,
  regular,
  from,
  hoursPerDay,
  includeWeekends,
}: PlanRequest): PlanResult {
  const exams = subjects
    .filter((subject) => subject.examDate && subject.examDate >= from)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))
  if (!exams.length)
    return {
      entries: [],
      sessions: 0,
      days: 0,
      error:
        'Add an exam date to at least one subject first. The plan is built around when your exams are.',
    }

  const lastExam = exams[exams.length - 1]!.examDate
  const entries: EntryInput[] = exams.map((subject) => ({
    subjectId: subject.id,
    title: `${subject.name} exam`,
    kind: 'exam' as const,
    plan: 'intensive' as const,
    date: subject.examDate,
    day: dayIndexOf(subject.examDate),
    startMin: DAY_START,
    endMin: DAY_START + 60,
    room: '',
  }))

  const budget = Math.round(Math.max(1, hoursPerDay) * 60)
  const today = todayISO()
  const now = minutesNow()
  let cursor = from
  let days = 0
  let guard = 0

  while (cursor <= lastExam && guard < 120) {
    guard += 1
    const weekday = dayIndexOf(cursor)
    const active = exams.filter((subject) => subject.examDate >= cursor)
    if ((weekday < 5 || includeWeekends) && active.length) {
      const busy = [
        ...regular
          .filter((entry) => entry.day === weekday && entry.kind !== 'break')
          .map((entry) => ({ start: entry.startMin, end: entry.endMin })),
        ...entries
          .filter((entry) => entry.kind === 'exam' && entry.date === cursor)
          .map((entry) => ({ start: entry.startMin, end: entry.endMin })),
      ]
      const windows = freeWindows(busy, DAY_START, DAY_END)
        .map((window) =>
          cursor === today
            ? { ...window, start: Math.max(window.start, Math.ceil((now + 10) / 5) * 5) }
            : window,
        )
        .filter((window) => window.end - window.start >= MIN_SESSION)
      const slots = sessionLengths(budget)
      if (windows.length && slots.length) {
        days += 1
        const weightOf = new Map(
          active.map((subject) => [
            subject.id,
            1 + 8 / Math.max(1, daysBetween(cursor, subject.examDate)),
          ]),
        )
        const totalWeight = [...weightOf.values()].reduce((sum, value) => sum + value, 0)
        const assigned = new Map<string, number>(active.map((subject) => [subject.id, 0]))
        let planned = 0
        let slotIndex = 0

        for (const window of windows) {
          let at = window.start
          while (slotIndex < slots.length) {
            const length = slots[slotIndex]!
            if (at + length > window.end) break
            planned += length
            // Give the slot to whichever subject is furthest behind its share.
            let pick = active[0]!
            let bestDeficit = Number.NEGATIVE_INFINITY
            for (const subject of active) {
              const target =
                (planned * (weightOf.get(subject.id) ?? 1)) / totalWeight
              const deficit = target - (assigned.get(subject.id) ?? 0)
              if (deficit > bestDeficit) {
                bestDeficit = deficit
                pick = subject
              }
            }
            assigned.set(pick.id, (assigned.get(pick.id) ?? 0) + length)
            entries.push({
              subjectId: pick.id,
              title: `${pick.name} revision`,
              kind: 'study',
              plan: 'intensive',
              date: cursor,
              day: weekday,
              startMin: at,
              endMin: at + length,
              room: '',
            })
            at += length + GAP
            slotIndex += 1
          }
          if (slotIndex >= slots.length) break
        }
      }
    }
    cursor = addDays(cursor, 1)
  }

  return {
    entries,
    sessions: entries.filter((entry) => entry.kind === 'study').length,
    days,
  }
}
