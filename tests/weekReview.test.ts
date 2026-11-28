import { expect, test } from 'bun:test'
import { addDays } from '../src/client/dates'
import { weekReview } from '../src/client/weekReview'
import type { Entry, Subject } from '../src/shared/types'

const today = '2026-11-28'

const subject = (id: string, name: string): Subject => ({
  id,
  name,
  color: '#3f6b52',
  teacher: '',
  examDate: '',
  createdAt: 0,
})

const subjects = [subject('maths', 'Mathematics'), subject('science', 'Science')]

const study = (
  date: string,
  subjectId: string | null,
  minutes: number,
): Entry => ({
  id: `${date}-${subjectId}-${minutes}`,
  subjectId,
  title: 'Revision',
  kind: 'study',
  plan: 'intensive',
  day: 0,
  startMin: 18 * 60,
  endMin: 18 * 60 + minutes,
  room: '',
  date,
})

test('an evening with planned blocks and no check-in is counted as skipped', () => {
  const review = weekReview({
    entries: [
      study(addDays(today, -1), 'maths', 50),
      study(addDays(today, -2), 'science', 40),
    ],
    logs: [{ date: addDays(today, -1) }],
    subjects,
    today,
  })
  expect(review.nights).toHaveLength(7)
  expect(review.from).toBe(addDays(today, -7))
  expect(review.to).toBe(addDays(today, -1))
  expect(review.plannedNights).toBe(2)
  expect(review.checkedInNights).toBe(1)
  expect(review.loggedNights).toBe(1)
  expect(review.plannedMinutes).toBe(90)
  expect(review.skippedMinutes).toBe(40)
  expect(review.subjects.map((row) => row.name)).toEqual(['Science'])
  expect(review.worst?.name).toBe('Science')
})

test("tonight's plan is left out because the evening has not happened", () => {
  const review = weekReview({
    entries: [study(today, 'maths', 50)],
    logs: [{ date: today }],
    subjects,
    today,
  })
  expect(review.plannedMinutes).toBe(0)
  expect(review.plannedNights).toBe(0)
  expect(review.skippedMinutes).toBe(0)
  // Tonight is not one of the seven finished evenings, check-in or not.
  expect(review.loggedNights).toBe(0)
  expect(review.to).toBe(addDays(today, -1))
})

test('the subject skipped on the most evenings is named first', () => {
  const review = weekReview({
    entries: [
      study(addDays(today, -2), 'maths', 50),
      study(addDays(today, -3), 'maths', 50),
      study(addDays(today, -1), 'science', 45),
    ],
    logs: [{ date: addDays(today, -1) }],
    subjects,
    today,
  })
  expect(review.worst?.name).toBe('Mathematics')
  expect(review.worst?.skippedMinutes).toBe(100)
  expect(review.worst?.eveningsPlanned).toBe(2)
  expect(review.worst?.eveningsCheckedIn).toBe(0)
  expect(review.skippedMinutes).toBe(100)
})

test('a subject whose evenings were all checked in is not listed as skipped', () => {
  const review = weekReview({
    entries: [
      study(addDays(today, -1), 'science', 45),
      study(addDays(today, -2), 'maths', 40),
    ],
    logs: [{ date: addDays(today, -1) }],
    subjects,
    today,
  })
  expect(review.subjects).toHaveLength(1)
  expect(review.subjects[0]!.name).toBe('Mathematics')
})

test('a check-in on an evening with no plan counts as a logged evening, not study', () => {
  const review = weekReview({
    entries: [],
    logs: [{ date: addDays(today, -4) }],
    subjects,
    today,
  })
  expect(review.loggedNights).toBe(1)
  expect(review.plannedNights).toBe(0)
  expect(review.plannedMinutes).toBe(0)
  expect(review.checkedInNights).toBe(0)
  expect(review.worst).toBeNull()
})

test('blocks without a subject are kept as General instead of being dropped', () => {
  const review = weekReview({
    entries: [study(addDays(today, -5), null, 30)],
    logs: [],
    subjects,
    today,
  })
  expect(review.subjects[0]?.name).toBe('General')
  expect(review.subjects[0]?.subjectId).toBeNull()
  expect(review.skippedMinutes).toBe(30)
})
