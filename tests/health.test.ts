import { expect, test } from 'bun:test'
import { unitsFor } from '../src/shared/curriculum.ts'
import type { Subject, SyllabusTick, Task } from '../src/shared/types'
import {
  behindScore,
  healthNote,
  subjectHealth,
} from '../src/client/subjectHealth.ts'

const TODAY = '2026-11-28'

const subject = (id: string, name: string, examDate = ''): Subject => ({
  id,
  name,
  color: '#3f6b52',
  teacher: '',
  examDate,
  createdAt: 0,
})

const task = (
  id: string,
  subjectId: string | null,
  dueDate: string,
  done = false,
): Task => ({
  id,
  subjectId,
  title: id,
  dueDate,
  priority: 'normal',
  done,
  details: '',
  createdAt: 0,
})

/** Every chapter of a subject ticked off, as the syllabus page writes them. */
const allTicked = (subjectId: string, name: string): SyllabusTick[] =>
  unitsFor(10, name).map((chapter) => ({ subjectId, chapter }))

test('the subject with the least time per chapter is first', () => {
  const rows = subjectHealth({
    subjects: [
      subject('eng', 'English'),
      subject('sci', 'Science', '2026-12-14'),
      subject('math', 'Mathematics', '2026-12-18'),
    ],
    syllabus: [],
    tasks: [],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows.map((row) => row.subject.id)).toEqual(['sci', 'math', 'eng'])
  // 13 chapters in 16 days and 14 in 20 days are both too much to call steady.
  expect(rows.map((row) => row.status)).toEqual(['behind', 'behind', 'watch'])
  expect(rows[0]!.daysToExam).toBe(16)
  expect(rows[0]!.chaptersLeft).toBe(13)
})

test('late work lifts a subject that has everything ticked', () => {
  const rows = subjectHealth({
    subjects: [
      subject('math', 'Mathematics', '2027-02-01'),
      subject('sci', 'Science', '2027-02-01'),
    ],
    syllabus: [
      ...allTicked('math', 'Mathematics'),
      ...allTicked('sci', 'Science'),
    ],
    tasks: [
      task('a', 'math', '2026-11-20'),
      task('b', 'math', '2026-11-25'),
      // Done work is not behind, however late it was.
      task('c', 'sci', '2026-11-10', true),
    ],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows.map((row) => row.subject.id)).toEqual(['math', 'sci'])
  expect(rows[0]!.status).toBe('behind')
  expect(rows[0]!.overdue).toBe(2)
  expect(rows[1]!.status).toBe('clear')
  expect(rows[1]!.score).toBe(0)
})

test('a chapter left inside the last week before the exam is behind', () => {
  const chapters = unitsFor(10, 'Mathematics')
  const rows = subjectHealth({
    subjects: [subject('math', 'Mathematics', '2026-12-01')],
    syllabus: chapters
      .slice(0, chapters.length - 1)
      .map((chapter) => ({ subjectId: 'math', chapter })),
    tasks: [],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows[0]!.daysToExam).toBe(3)
  expect(rows[0]!.chaptersLeft).toBe(1)
  expect(rows[0]!.status).toBe('behind')
})

test('the note says what is left, when the exam is and what went late', () => {
  const chapters = unitsFor(10, 'Science')
  const rows = subjectHealth({
    subjects: [subject('sci', 'Science', '2026-12-10')],
    syllabus: chapters
      .slice(0, 6)
      .map((chapter) => ({ subjectId: 'sci', chapter })),
    tasks: [task('lab', 'sci', '2026-11-26')],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows[0]!.pacePerWeek).toBe(4.1)
  expect(healthNote(rows[0]!)).toBe(
    '7 of 13 chapters left · exam in 12 days · 1 overdue task · 4.1 chapters a week to finish',
  )
})

test('a past exam date stops counting down but still shows in the note', () => {
  const rows = subjectHealth({
    subjects: [subject('math', 'Mathematics', '2026-11-20')],
    syllabus: allTicked('math', 'Mathematics'),
    tasks: [],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows[0]!.daysToExam).toBeNull()
  expect(rows[0]!.pacePerWeek).toBeNull()
  expect(rows[0]!.status).toBe('clear')
  expect(healthNote(rows[0]!)).toBe(
    'All 14 chapters ticked · exam date has passed',
  )
})

test('a card answered Again lifts a subject whose chapters are all ticked', () => {
  const rows = subjectHealth({
    subjects: [subject('math', 'Mathematics', '2027-02-01')],
    syllabus: allTicked('math', 'Mathematics'),
    tasks: [],
    classLevel: 10,
    today: TODAY,
    mistakes: [{ subjectId: 'math', cards: 4 }],
  })
  expect(rows[0]!.chaptersLeft).toBe(0)
  expect(rows[0]!.mistakes).toBe(4)
  expect(rows[0]!.score).toBe(2)
  // Nothing left on paper, but the cards are not sticking, so not clear.
  expect(rows[0]!.status).toBe('watch')
  expect(healthNote(rows[0]!)).toBe(
    'All 14 chapters ticked · exam in 65 days · 4 missed cards',
  )
})

test('missed cards are worth half a point each, capped at two', () => {
  expect(behindScore({ chaptersLeft: 0, overdue: 0, daysToExam: null })).toBe(0)
  expect(
    behindScore({ chaptersLeft: 0, overdue: 0, daysToExam: null, mistakes: 1 }),
  ).toBe(0.5)
  expect(
    behindScore({ chaptersLeft: 0, overdue: 0, daysToExam: null, mistakes: 4 }),
  ).toBe(2)
  // A deck answered wrong all evening cannot bury the exam deadline.
  expect(
    behindScore({ chaptersLeft: 0, overdue: 0, daysToExam: null, mistakes: 40 }),
  ).toBe(2)
})

test('a subject without a chapter list is counted by its work alone', () => {
  const rows = subjectHealth({
    subjects: [subject('cs', 'Computer Science')],
    syllabus: [],
    tasks: [task('file', 'cs', '2026-11-27')],
    classLevel: 10,
    today: TODAY,
  })
  expect(rows[0]!.chaptersTotal).toBe(0)
  expect(rows[0]!.status).toBe('watch')
  expect(healthNote(rows[0]!)).toBe(
    'No chapter list for this subject yet · no exam date · 1 overdue task',
  )
})
