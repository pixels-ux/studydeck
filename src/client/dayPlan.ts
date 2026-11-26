import type { DayHomework, Entry, EntryInput } from '../shared/types'
import { dayIndexOf } from './dates'

/**
 * Builds the evening after a real school day.
 *
 * The inputs are what actually happened: the topics covered in school and at
 * coaching, the homework that was set, and the student's own free window. The
 * output is study blocks and breaks that fit that window. Breaks grow when the
 * day was heavy (a backlog, a lot of homework, several new topics) instead of
 * being a fixed 10 minutes.
 */

export type BacklogSubject = {
  subjectId: string
  name: string
  /** Higher means further behind, so it gets the leftover time first. */
  weight: number
}

export type Backlog = {
  overdueTasks: number
  chaptersLeft: number
  nearestExamInDays: number | null
  subjects: BacklogSubject[]
}

/** A revision block from an earlier day that was never done. */
export type RecoveredBlock = {
  /** The timetable entry the block comes from. */
  id: string
  subjectId: string | null
  title: string
  minutes: number
}

export type EveningPlanInput = {
  date: string
  freeFrom: number
  freeUntil: number
  homework: Pick<DayHomework, 'subjectId' | 'title' | 'minutes'>[]
  covered: { subjectId: string | null; title: string; topic: string }[]
  backlog: Backlog
  /** Blocks skipped on earlier days, offered a place tonight. */
  recovered?: RecoveredBlock[]
}

export type EveningPlan = {
  entries: EntryInput[]
  studyMinutes: number
  breakMinutes: number
  missedHomeworkMinutes: number
  breakLength: number
  /** The recovered blocks that found room tonight, by timetable id. */
  pulledIds: string[]
  /** Minutes of recovered work that did not fit in the window. */
  missedRecoveryMinutes: number
}

const REVIEW = 20
const HOMEWORK_BLOCK = 45
const BACKLOG_BLOCK = 40
const SMALLEST_BLOCK = 15
const MAX_REVIEWS = 2
const BREAK_EVERY = 50

/**
 * How long a break should be. A normal evening gets 10 minutes; a backlog, a
 * lot of homework or several new topics each add a little, so a hard day is
 * planned with real recovery rather than four hours straight.
 */
export function breakLengthFor({
  homework,
  covered,
  backlog,
}: {
  homework: { minutes: number }[]
  covered: EveningPlanInput['covered']
  backlog: Backlog
}): number {
  const homeworkMinutes = homework.reduce((sum, item) => sum + item.minutes, 0)
  const topics = covered.filter((item) => item.topic.trim()).length
  let minutes = 10
  if (backlog.overdueTasks > 0) minutes += 3
  if (backlog.chaptersLeft > 5) minutes += 2
  if (homeworkMinutes >= 90) minutes += 5
  if (topics >= 3) minutes += 2
  return Math.min(20, minutes)
}

type Block = {
  title: string
  subjectId: string | null
  minutes: number
  kind: 'study' | 'break'
}

/** A review block for what was taught, one per subject, at most two. */
function reviewBlocks(covered: EveningPlanInput['covered']): Block[] {
  const seen = new Set<string>()
  const blocks: Block[] = []
  for (const item of covered) {
    const topic = item.topic.trim()
    if (!topic) continue
    const key = `${item.subjectId ?? item.title}::${topic.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push({
      title: `Review · ${item.title}: ${topic}`.slice(0, 60),
      subjectId: item.subjectId,
      minutes: REVIEW,
      kind: 'study',
    })
    if (blocks.length >= MAX_REVIEWS) break
  }
  return blocks
}

/** Homework is cut into blocks a person can actually sit through. */
function homeworkBlocks(homework: EveningPlanInput['homework']): Block[] {
  const blocks: Block[] = []
  for (const item of homework) {
    let left = Math.max(0, Math.round(item.minutes))
    if (!left) continue
    const title = item.title.trim() || 'Homework'
    while (left > 0) {
      let slice = Math.min(HOMEWORK_BLOCK, left)
      // Do not leave a five-minute stub at the end of a subject.
      if (left > HOMEWORK_BLOCK && left - HOMEWORK_BLOCK < SMALLEST_BLOCK)
        slice = left
      blocks.push({ title, subjectId: item.subjectId, minutes: slice, kind: 'study' })
      left -= slice
    }
  }
  return blocks
}

/**
 * The plan: reviews first (they are freshest), then homework in the order it
 * was given, then whatever window is left to the subjects furthest behind.
 */
export function buildEveningPlan({
  date,
  freeFrom,
  freeUntil,
  homework,
  covered,
  backlog,
  recovered = [],
}: EveningPlanInput): EveningPlan {
  const breakLength = breakLengthFor({ homework, covered, backlog })
  if (freeUntil - freeFrom < SMALLEST_BLOCK)
    return {
      entries: [],
      studyMinutes: 0,
      breakMinutes: 0,
      missedHomeworkMinutes: homework.reduce((sum, item) => sum + item.minutes, 0),
      breakLength,
      pulledIds: [],
      missedRecoveryMinutes: recovered.reduce(
        (sum, item) => sum + Math.max(0, Math.round(item.minutes)),
        0,
      ),
    }

  const fixed = [...reviewBlocks(covered), ...homeworkBlocks(homework)]
  const entries: EntryInput[] = []
  const day = dayIndexOf(date)
  let at = freeFrom
  let studyMinutes = 0
  let breakMinutes = 0
  let studySinceBreak = 0
  let missedHomeworkMinutes = 0

  const place = (block: Block) => {
    const entry: EntryInput = {
      subjectId: block.subjectId,
      title: block.title,
      kind: block.kind,
      plan: 'intensive',
      day,
      startMin: at,
      endMin: at + block.minutes,
      room: '',
      date,
    }
    entries.push(entry)
    at += block.minutes
    if (block.kind === 'break') breakMinutes += block.minutes
    else studyMinutes += block.minutes
  }

  fixed.forEach((block, index) => {
    if (at + block.minutes > freeUntil) {
      missedHomeworkMinutes += block.minutes
      return
    }
    place(block)
    studySinceBreak += block.minutes
    const moreWork = index < fixed.length - 1
    if (studySinceBreak >= BREAK_EVERY && moreWork && at + breakLength <= freeUntil) {
      place({
        title: 'Break',
        subjectId: null,
        minutes: breakLength,
        kind: 'break',
      })
      studySinceBreak = 0
    }
  })

  // Work that was planned for an earlier day but not done: homework first,
  // then what was missed, then the general catch-up. A block that no longer
  // fits is reported, not silently dropped.
  const pulledIds: string[] = []
  let missedRecoveryMinutes = 0
  for (const item of recovered) {
    const minutes = Math.max(SMALLEST_BLOCK, Math.round(item.minutes))
    if (at + minutes > freeUntil) {
      missedRecoveryMinutes += minutes
      continue
    }
    if (studySinceBreak >= BREAK_EVERY && at + breakLength + minutes <= freeUntil) {
      place({
        title: 'Break',
        subjectId: null,
        minutes: breakLength,
        kind: 'break',
      })
      studySinceBreak = 0
    }
    place({ title: item.title, subjectId: item.subjectId, minutes, kind: 'study' })
    pulledIds.push(item.id)
    studySinceBreak += minutes
  }

  // Leftover window goes to backlog, cycling through the subjects.
  const queue = [...backlog.subjects].sort((a, b) => b.weight - a.weight)
  let cursor = 0
  while (queue.length && at + BACKLOG_BLOCK <= freeUntil) {
    const subject = queue[cursor % queue.length]!
    cursor += 1
    if (studySinceBreak >= BREAK_EVERY && at + breakLength + 20 <= freeUntil) {
      place({
        title: 'Break',
        subjectId: null,
        minutes: breakLength,
        kind: 'break',
      })
      studySinceBreak = 0
      continue
    }
    place({
      title: `${subject.name} · catch up`,
      subjectId: subject.subjectId,
      minutes: BACKLOG_BLOCK,
      kind: 'study',
    })
    studySinceBreak += BACKLOG_BLOCK
  }

  return {
    entries,
    studyMinutes,
    breakMinutes,
    missedHomeworkMinutes,
    breakLength,
    pulledIds,
    missedRecoveryMinutes,
  }
}

function entryInput(entry: Entry): EntryInput {
  return {
    subjectId: entry.subjectId,
    title: entry.title,
    kind: entry.kind,
    day: entry.day,
    startMin: entry.startMin,
    endMin: entry.endMin,
    room: entry.room,
    plan: entry.plan,
    date: entry.date,
  }
}

/**
 * The past days a carried or dropped block leaves, each with whatever stays.
 * Only days touched by `leaving` appear, so untouched days are never rewritten.
 */
export function planWithout(
  entries: Entry[],
  leaving: Set<string>,
): { date: string; entries: EntryInput[] }[] {
  const byDate = new Map<string, EntryInput[]>()
  const touched = new Set<string>()
  for (const entry of entries) {
    if (entry.plan !== 'intensive' || !entry.date) continue
    const kept = byDate.get(entry.date) ?? []
    if (leaving.has(entry.id)) touched.add(entry.date)
    else kept.push(entryInput(entry))
    byDate.set(entry.date, kept)
  }
  return [...touched]
    .sort()
    .map((date) => ({ date, entries: byDate.get(date) ?? [] }))
}

/** What is actually behind: overdue work, unread chapters and exam pressure. */
export function backlogOf({
  tasks,
  today,
  subjects,
  chaptersLeft,
}: {
  tasks: { subjectId: string | null; dueDate: string; done: boolean }[]
  today: string
  subjects: {
    id: string
    name: string
    examDate: string
    chaptersTotal: number
    chaptersDone: number
  }[]
  chaptersLeft: number
}): Backlog {
  const overdue = tasks.filter((task) => !task.done && task.dueDate && task.dueDate < today)
  const overdueBySubject = new Map<string, number>()
  for (const task of overdue)
    if (task.subjectId)
      overdueBySubject.set(task.subjectId, (overdueBySubject.get(task.subjectId) ?? 0) + 1)

  const examDays = subjects
    .filter((subject) => subject.examDate && subject.examDate >= today)
    .map((subject) =>
      Math.round(
        (new Date(`${subject.examDate}T00:00:00Z`).getTime() -
          new Date(`${today}T00:00:00Z`).getTime()) /
          86_400_000,
      ),
    )
  const nearestExamInDays = examDays.length ? Math.min(...examDays) : null

  const weighted = subjects
    .map((subject) => {
      const remaining = Math.max(0, subject.chaptersTotal - subject.chaptersDone)
      const examSoon = subject.examDate
        ? Math.max(0, 30 - Math.round((new Date(`${subject.examDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000))
        : 0
      return {
        subjectId: subject.id,
        name: subject.name,
        weight:
          remaining +
          (overdueBySubject.get(subject.id) ?? 0) * 2 +
          examSoon / 5,
      }
    })
    .filter((subject) => subject.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  return {
    overdueTasks: overdue.length,
    chaptersLeft,
    nearestExamInDays,
    subjects: weighted,
  }
}
