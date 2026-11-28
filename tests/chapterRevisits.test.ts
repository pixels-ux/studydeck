import { expect, test } from 'bun:test'
import { addDays } from '../src/client/dates'
import { chapterRevisits, REVISIT_AFTER_DAYS } from '../src/client/chapterReview'
import type { SyllabusTick } from '../src/shared/types'
import type { Subject } from '../src/shared/types'

const today = '2026-11-28'

const subject = (id: string, name: string, examDate = ''): Subject => ({
  id,
  name,
  color: '#3f6b52',
  teacher: '',
  examDate,
  createdAt: 0,
})

/** Local noon on a day, so a whole number of days separates it from today. */
const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime()

const tick = (subjectId: string, chapter: string, daysAgo: number | null): SyllabusTick => ({
  subjectId,
  chapter,
  ...(daysAgo === null ? {} : { tickedAt: at(addDays(today, -daysAgo)) }),
})

test('a chapter comes back a week after it was ticked, not before', () => {
  const review = chapterRevisits({
    subjects: [subject('maths', 'Mathematics')],
    syllabus: [
      tick('maths', 'Polynomials', REVISIT_AFTER_DAYS),
      tick('maths', 'Triangles', REVISIT_AFTER_DAYS - 1),
      tick('maths', 'Circles', 30),
    ],
    today,
  })
  expect(review.map((row) => row.chapter)).toEqual(['Circles', 'Polynomials'])
  expect(review.find((row) => row.chapter === 'Polynomials')?.daysSince).toBe(7)
  expect(review.find((row) => row.chapter === 'Circles')?.daysSince).toBe(30)
})

test('a tick from before the timestamp existed is left alone', () => {
  const review = chapterRevisits({
    subjects: [subject('maths', 'Mathematics')],
    syllabus: [tick('maths', 'Polynomials', null)],
    today,
  })
  expect(review).toEqual([])
})

test('a subject whose exam has passed drops out, and its rows carry the exam distance', () => {
  const review = chapterRevisits({
    subjects: [
      subject('done', 'Passed', addDays(today, -1)),
      subject('soon', 'Soon', addDays(today, 3)),
      subject('later', 'Later'),
    ],
    syllabus: [
      tick('done', 'Trigonometry', 10),
      tick('soon', 'Light', 9),
      tick('later', 'Algebra', 8),
    ],
    today,
  })
  expect(review.map((row) => row.subjectName)).toEqual(['Soon', 'Later'])
  expect(review[0]!.daysToExam).toBe(3)
  expect(review[1]!.daysToExam).toBeNull()
})

test('the nearest exam comes first, then the chapter left longest', () => {
  const review = chapterRevisits({
    subjects: [
      subject('a', 'Maths', addDays(today, 20)),
      subject('b', 'Science', addDays(today, 4)),
    ],
    syllabus: [
      tick('a', 'Old maths chapter', 21),
      tick('b', 'Near exam chapter', 8),
      tick('a', 'Newer maths chapter', 8),
    ],
    today,
  })
  expect(review.map((row) => row.subjectName)).toEqual([
    'Science',
    'Maths',
    'Maths',
  ])
  expect(review[1]!.chapter).toBe('Old maths chapter')
})

test('a tick whose subject is gone cannot be revisited', () => {
  const review = chapterRevisits({
    subjects: [subject('maths', 'Mathematics')],
    syllabus: [tick('deleted', 'Ghost chapter', 20)],
    today,
  })
  expect(review).toEqual([])
})

test('the revisit day and the subject details come along for the card', () => {
  const review = chapterRevisits({
    subjects: [subject('maths', 'Mathematics', addDays(today, 12))],
    syllabus: [tick('maths', 'Polynomials', 9)],
    today,
  })
  expect(review).toHaveLength(1)
  expect(review[0]!.subjectId).toBe('maths')
  expect(review[0]!.tickedOn).toBe(addDays(today, -9))
  expect(review[0]!.color).toBe('#3f6b52')
})
