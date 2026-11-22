import { expect, test } from 'bun:test'
import { addDays, dayIndexOf, minutesNow, todayISO } from '../src/client/dates'
import { buildRevisionPlan } from '../src/client/plan'
import type { Entry, Subject } from '../src/shared/types'

const today = todayISO()

const subjects: Subject[] = [
  { id: 'maths', name: 'Mathematics', color: '#3f6b52', teacher: '', examDate: addDays(today, 10), createdAt: 1 },
  { id: 'science', name: 'Science', color: '#6a7f3f', teacher: '', examDate: addDays(today, 4), createdAt: 2 },
]

const school: Entry[] = [0, 1, 2, 3, 4].map((day) => ({
  id: `class-${day}`,
  subjectId: null,
  title: 'Class',
  kind: 'class',
  plan: 'regular',
  day,
  startMin: 8 * 60,
  endMin: 14 * 60 + 30,
  room: '',
  date: '',
}))

test('study sessions never land on a school class or in already-passed hours', () => {
  const plan = buildRevisionPlan({
    subjects,
    regular: school,
    from: today,
    hoursPerDay: 3,
    includeWeekends: true,
  })
  expect(plan.error).toBeUndefined()
  const study = plan.entries.filter((entry) => entry.kind === 'study')
  expect(study.length).toBeGreaterThan(0)

  for (const session of study) {
    expect(dayIndexOf(session.date)).toBe(session.day)
    expect(session.endMin).toBeGreaterThan(session.startMin)
    if (session.date === today) {
      expect(session.startMin).toBeGreaterThanOrEqual(minutesNow())
    }
    const sameWeekday = school.filter((entry) => entry.day === session.day)
    for (const block of sameWeekday) {
      const overlaps = session.startMin < block.endMin && block.startMin < session.endMin
      expect(overlaps).toBe(false)
    }
  }
})

test('a free day uses its whole study budget instead of stranding minutes', () => {
  const plan = buildRevisionPlan({
    subjects,
    regular: [],
    from: addDays(today, 1),
    hoursPerDay: 3,
    includeWeekends: true,
  })
  const firstDay = plan.entries
    .filter((entry) => entry.kind === 'study' && entry.date === addDays(today, 1))
    .reduce((total, entry) => total + (entry.endMin - entry.startMin), 0)
  expect(firstDay).toBe(180)
})

test('the nearest exam gets the most time and exams become calendar slots', () => {
  const plan = buildRevisionPlan({
    subjects,
    regular: school,
    from: addDays(today, 1),
    hoursPerDay: 3,
    includeWeekends: true,
  })
  const exams = plan.entries.filter((entry) => entry.kind === 'exam')
  expect(exams.map((entry) => entry.date).sort()).toEqual(
    [subjects[0]!.examDate, subjects[1]!.examDate].sort(),
  )
  // Compare only the days where both exams are still ahead of the student.
  const minutes = (id: string) =>
    plan.entries
      .filter(
        (entry) =>
          entry.kind === 'study' &&
          entry.subjectId === id &&
          entry.date <= addDays(today, 3),
      )
      .reduce((total, entry) => total + (entry.endMin - entry.startMin), 0)
  expect(minutes('science')).toBeGreaterThan(minutes('maths'))
})

test('no exam dates means a clear message instead of a plan', () => {
  const plan = buildRevisionPlan({
    subjects: subjects.map((subject) => ({ ...subject, examDate: '' })),
    regular: school,
    from: today,
    hoursPerDay: 3,
    includeWeekends: true,
  })
  expect(plan.entries).toHaveLength(0)
  expect(plan.error).toContain('exam date')
})
