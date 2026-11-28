import { expect, test } from 'bun:test'
import { addDays, dayIndexOf, minutesNow, todayISO } from '../src/client/dates'
import { buildRevisionPlan } from '../src/client/plan'
import { subjectHealth } from '../src/client/subjectHealth'
import { unitsFor } from '../src/shared/curriculum'
import type { Entry, Subject, SyllabusTick } from '../src/shared/types'

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

/** The health rows a page would show for these subjects on any day. */
const healthFor = (
  list: Subject[],
  syllabus: SyllabusTick[] = [],
  at = today,
) =>
  subjectHealth({ subjects: list, syllabus, tasks: [], classLevel: 10, today: at })

test('study sessions never land on a school class or in already-passed hours', () => {
  const plan = buildRevisionPlan({
    subjects,
    regular: school,
    health: healthFor(subjects),
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
    health: healthFor(subjects),
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
    health: healthFor(subjects),
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
  const undated = subjects.map((subject) => ({ ...subject, examDate: '' }))
  const plan = buildRevisionPlan({
    subjects: undated,
    regular: school,
    health: healthFor(undated),
    from: today,
    hoursPerDay: 3,
    includeWeekends: true,
  })
  expect(plan.entries).toHaveLength(0)
  expect(plan.error).toContain('exam date')
})

test('the plan shares the week out by the health page score, not exam order alone', () => {
  // English has the next exam but every chapter ticked, so it scores nothing.
  const list: Subject[] = [
    { id: 'eng', name: 'English', color: '#40607a', teacher: '', examDate: addDays(today, 3), createdAt: 3 },
    { id: 'sci', name: 'Science', color: '#6a7f3f', teacher: '', examDate: addDays(today, 10), createdAt: 2 },
    { id: 'math', name: 'Mathematics', color: '#3f6b52', teacher: '', examDate: addDays(today, 21), createdAt: 1 },
  ]
  const health = healthFor(list, [
    ...unitsFor(10, 'English').map((chapter) => ({ subjectId: 'eng', chapter })),
    // Half of maths is ticked; science has not been started.
    ...unitsFor(10, 'Mathematics')
      .slice(0, 7)
      .map((chapter) => ({ subjectId: 'math', chapter })),
  ])
  expect(health.map((row) => row.subject.id)).toEqual(['sci', 'math', 'eng'])
  expect(health[2]!.score).toBe(0)

  const plan = buildRevisionPlan({
    subjects: list,
    regular: [],
    health,
    from: addDays(today, 1),
    hoursPerDay: 2,
    includeWeekends: true,
  })
  const study = plan.entries.filter((entry) => entry.kind === 'study')
  expect(study.length).toBeGreaterThan(0)
  // The first slot goes to whatever Subject health names first.
  expect(study[0]!.subjectId).toBe(health[0]!.subject.id)

  // Only the days where both exams are still ahead, so the comparison is fair.
  const window = addDays(today, 10)
  const minutes = (id: string) =>
    study
      .filter((entry) => entry.subjectId === id && entry.date <= window)
      .reduce((total, entry) => total + (entry.endMin - entry.startMin), 0)
  // A clear subject gets nothing, even with the nearest exam.
  expect(minutes('eng')).toBe(0)
  // More score means more time, and a small share is still honoured rather
  // than starved by the two sessions a day holds.
  expect(minutes('sci')).toBeGreaterThan(minutes('math'))
  expect(minutes('math')).toBeGreaterThan(0)
})
