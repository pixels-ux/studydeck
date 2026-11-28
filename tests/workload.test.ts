import { expect, test } from 'bun:test'
import { addDays, todayISO } from '../src/client/dates'
import type { Subject, SyllabusTick } from '../src/shared/types'
import { subjectHealth } from '../src/client/subjectHealth'
import { unitsFor } from '../src/shared/curriculum'
import { CHAPTER_MINUTES, workloadCheck } from '../src/client/workload'

const today = todayISO()

const subject = (id: string, name: string, examDate: string): Subject => ({
  id,
  name,
  color: '#3f6b52',
  teacher: '',
  examDate,
  createdAt: 0,
})

/** Health rows with exactly the chapters and exam distance a test wants. */
const rowsWith = (
  list: {
    name: string
    chaptersLeft: number
    daysToExam: number | null
    examDate?: string
  }[],
) =>
  list.map((row) => ({
    subject: subject(row.name, row.name, row.examDate ?? ''),
    chaptersTotal: 10,
    chaptersDone: 10 - row.chaptersLeft,
    chaptersLeft: row.chaptersLeft,
    daysToExam: row.daysToExam,
    pacePerWeek: null,
    overdue: 0,
    openTasks: 0,
    mistakes: 0,
    score: 1,
    status: 'steady' as const,
  }))

test('the weekly hours the student set become the weekly hours available', () => {
  const workload = workloadCheck({
    health: rowsWith([{ name: 'Maths', chaptersLeft: 10, daysToExam: null }]),
    studyHours: 3,
  })
  expect(workload.weeklyMinutes).toBe(3 * 60 * 7)
  // Ten chapters over the eight-week horizon used when there is no exam date.
  expect(workload.neededWeeklyMinutes).toBe(75)
  expect(workload.hoursToCover).toBe(10)
  expect(workload.verdict).toBe('fits')
  expect(workload.gapHours).toBe(20)
})

test('a heavy chapter load before an exam is reported as not fitting', () => {
  const workload = workloadCheck({
    health: rowsWith([
      { name: 'Science', chaptersLeft: 20, daysToExam: 7, examDate: addDays(today, 7) },
    ]),
    studyHours: 1,
  })
  expect(workload.neededWeeklyMinutes).toBe(20 * CHAPTER_MINUTES)
  expect(workload.verdict).toBe('over')
  expect(workload.gapHours).toBe(-13)
  expect(workload.firstExamDays).toBe(7)
})

test('a load that exactly uses the hours set is tight, not a comfortable fit', () => {
  const workload = workloadCheck({
    health: rowsWith([{ name: 'English', chaptersLeft: 7, daysToExam: 7 }]),
    studyHours: 1,
  })
  expect(workload.neededWeeklyMinutes).toBe(workload.weeklyMinutes)
  expect(workload.verdict).toBe('tight')
  expect(workload.gapHours).toBe(0)
})

test('with every chapter ticked there is nothing to fit, whatever the hours', () => {
  const workload = workloadCheck({
    health: rowsWith([{ name: 'Maths', chaptersLeft: 0, daysToExam: 3 }]),
    studyHours: 1,
  })
  expect(workload.chaptersLeft).toBe(0)
  expect(workload.neededWeeklyMinutes).toBe(0)
  expect(workload.verdict).toBe('clear')
  expect(workload.tightest).toBeNull()
  expect(workload.firstExamDate).toBe('')
})

test('each subject is spread over its own exam date, and the worst is named', () => {
  const workload = workloadCheck({
    health: rowsWith([
      { name: 'Maths', chaptersLeft: 4, daysToExam: 28 },
      { name: 'Science', chaptersLeft: 8, daysToExam: 14 },
    ]),
    studyHours: 1,
  })
  // 4 chapters over 4 weeks, plus 8 chapters over 2 weeks.
  expect(workload.neededWeeklyMinutes).toBe(60 + 240)
  expect(workload.tightest?.name).toBe('Science')
  expect(workload.tightest?.chaptersLeft).toBe(8)
  expect(workload.tightest?.weeks).toBe(2)
  // 5 hours a week of chapters against the 7 hours a week set.
  expect(workload.verdict).toBe('fits')
})

test('the first exam is the earliest one that still has chapters left', () => {
  const subjects = [
    subject('maths', 'Mathematics', addDays(today, 3)),
    subject('science', 'Science', addDays(today, 12)),
  ]
  const mathsTicked: SyllabusTick[] = unitsFor(10, 'Mathematics').map((chapter) => ({
    subjectId: 'maths',
    chapter,
  }))
  const health = subjectHealth({
    subjects,
    syllabus: mathsTicked,
    tasks: [],
    classLevel: 10,
    today,
  })
  const maths = health.find((row) => row.subject.id === 'maths')!
  const science = health.find((row) => row.subject.id === 'science')!
  expect(maths.chaptersLeft).toBe(0)

  const workload = workloadCheck({ health, studyHours: 2 })
  // Maths is ticked off, so its near exam cannot be the deadline that matters.
  expect(workload.firstExamDate).toBe(addDays(today, 12))
  expect(workload.chaptersLeft).toBe(science.chaptersLeft)
  expect(workload.tightest?.name).toBe('Science')
})
