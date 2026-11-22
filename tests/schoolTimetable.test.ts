import { expect, test } from 'bun:test'
import { buildSchoolTimetable, examDatesFromTests } from '../src/client/schoolTimetable'

const subjects = [
  { key: 's0', name: 'Mathematics' },
  { key: 's1', name: 'Science' },
  { key: 's2', name: 'Social Science' },
]

test('test subject names map onto their own subject key', () => {
  const dates = examDatesFromTests(subjects, [
    { date: '2026-11-29', subjectNames: ['Mathematics', 'Science'] },
    { date: '2026-11-22', subjectNames: ['Social Science'] },
  ])
  expect(dates).toEqual({
    s0: '2026-11-29',
    s1: '2026-11-29',
    s2: '2026-11-22',
  })
})

test('the earliest test wins and unknown or empty entries are ignored', () => {
  const dates = examDatesFromTests(subjects, [
    { date: '2026-12-04', subjectNames: ['science'] },
    { date: '2026-11-29', subjectNames: ['Science'] },
    { date: '', subjectNames: ['Mathematics'] },
    { date: '2026-11-30', subjectNames: ['Computer Science'] },
  ])
  expect(dates).toEqual({ s1: '2026-11-29' })
})

test('the school week fills each day without overlaps or a misplaced break', () => {
  const { entries, periods } = buildSchoolTimetable({
    subjects,
    days: [0, 1, 2, 3, 4],
    start: 480,
    end: 870,
    periodLength: 45,
    breakAfter: 4,
    breakLength: 30,
  })
  expect(periods).toBe(7)
  expect(entries).toHaveLength(5 * 8)
  for (const day of [0, 1, 2, 3, 4]) {
    const dayEntries = entries
      .filter((entry) => entry.day === day)
      .sort((a, b) => a.startMin - b.startMin)
    expect(dayEntries.filter((entry) => entry.kind === 'class')).toHaveLength(7)
    expect(dayEntries[4]!.kind).toBe('break')
    for (let index = 1; index < dayEntries.length; index += 1) {
      expect(dayEntries[index]!.startMin).toBeGreaterThanOrEqual(dayEntries[index - 1]!.endMin)
    }
    expect(dayEntries.at(-1)!.endMin).toBeLessThanOrEqual(870)
  }
  // Each day starts on a different subject, and every class carries a real key.
  const firstSubjects = [0, 1, 2, 3, 4].map(
    (day) => entries.find((entry) => entry.day === day && entry.kind === 'class')!.subjectId,
  )
  expect(new Set(firstSubjects).size).toBe(3)
  const classKeys = new Set(
    entries.filter((entry) => entry.kind === 'class').map((entry) => entry.subjectId),
  )
  expect(classKeys).toEqual(new Set(subjects.map((subject) => subject.key)))
})
