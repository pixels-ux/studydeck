import { expect, test } from 'bun:test'
import { backlogOf, breakLengthFor, buildEveningPlan } from '../src/client/dayPlan'
import { formatTimetable, parseTimetable } from '../src/client/timetableText'

const day = '2026-11-23'

const backlog = {
  overdueTasks: 0,
  chaptersLeft: 0,
  nearestExamInDays: null,
  subjects: [],
}

test('a typed timetable parses times, subjects and honest errors', () => {
  const parsed = parseTimetable(
    [
      '# Monday',
      '08:00-08:45 Mathematics',
      '8:50 – 9:35 Science',
      '10:00 to 10:45 am Social Science',
      '',
      'nonsense line',
      '11:00-10:00 Backwards',
    ].join('\n'),
  )
  expect(parsed.periods).toEqual([
    { startMin: 480, endMin: 525, subjectName: 'Mathematics' },
    { startMin: 530, endMin: 575, subjectName: 'Science' },
    { startMin: 600, endMin: 645, subjectName: 'Social Science' },
  ])
  expect(parsed.errors).toHaveLength(2)
  expect(parsed.errors[0]).toContain('Line 6')
  expect(parsed.errors[1]).toContain('finish after it starts')

  expect(formatTimetable(parsed.periods)).toBe(
    ['08:00-08:45 Mathematics', '08:50-09:35 Science', '10:00-10:45 Social Science'].join(
      '\n',
    ),
  )
  expect(parseTimetable('').periods).toEqual([])
})

test('reviews come first, homework next, and breaks appear between blocks', () => {
  const plan = buildEveningPlan({
    date: day,
    freeFrom: 17 * 60,
    freeUntil: 21 * 60,
    homework: [
      { subjectId: 's1', title: 'Algebra problems', minutes: 50 },
      { subjectId: 's2', title: 'Science questions', minutes: 30 },
    ],
    covered: [
      { subjectId: 's1', title: 'Mathematics', topic: 'Quadratic equations' },
      { subjectId: 's2', title: 'Science', topic: 'Refraction' },
      { subjectId: null, title: 'Coaching', topic: 'Refraction' },
    ],
    backlog,
  })

  const studies = plan.entries.filter((entry) => entry.kind === 'study')
  expect(studies[0]!.title).toContain('Quadratic equations')
  expect(studies[1]!.title).toContain('Refraction')
  expect(studies.some((entry) => entry.title === 'Algebra problems')).toBe(true)
  expect(plan.breakMinutes).toBeGreaterThan(0)
  expect(plan.entries.some((entry) => entry.kind === 'break')).toBe(true)

  // Nothing overlaps and everything fits the window.
  const sorted = [...plan.entries].sort((a, b) => a.startMin - b.startMin)
  expect(sorted[0]!.startMin).toBe(17 * 60)
  for (let index = 1; index < sorted.length; index += 1)
    expect(sorted[index]!.startMin).toBeGreaterThanOrEqual(sorted[index - 1]!.endMin)
  expect(sorted.at(-1)!.endMin).toBeLessThanOrEqual(21 * 60)
  expect(sorted.every((entry) => entry.date === day && entry.plan === 'intensive')).toBe(
    true,
  )
})

test('a heavy day earns longer breaks and leftover time goes to backlog', () => {
  const light = breakLengthFor({
    homework: [{ minutes: 30 }],
    covered: [],
    backlog,
  })
  const heavy = breakLengthFor({
    homework: [{ minutes: 120 }],
    covered: [
      { subjectId: 'a', title: 'A', topic: 'x' },
      { subjectId: 'b', title: 'B', topic: 'y' },
      { subjectId: 'c', title: 'C', topic: 'z' },
    ],
    backlog: { overdueTasks: 3, chaptersLeft: 9, nearestExamInDays: 4, subjects: [] },
  })
  expect(light).toBe(10)
  expect(heavy).toBeGreaterThan(light)
  expect(heavy).toBeLessThanOrEqual(20)

  const plan = buildEveningPlan({
    date: day,
    freeFrom: 17 * 60,
    freeUntil: 20 * 60,
    homework: [],
    covered: [],
    backlog: {
      overdueTasks: 2,
      chaptersLeft: 6,
      nearestExamInDays: 5,
      subjects: [
        { subjectId: 'm', name: 'Mathematics', weight: 9 },
        { subjectId: 's', name: 'Science', weight: 4 },
      ],
    },
  })
  const catchUp = plan.entries.filter((entry) => entry.title.includes('catch up'))
  expect(catchUp.length).toBeGreaterThan(1)
  expect(catchUp[0]!.subjectId).toBe('m')
})

test('homework that does not fit is reported rather than squeezed in', () => {
  const plan = buildEveningPlan({
    date: day,
    freeFrom: 20 * 60,
    freeUntil: 20 * 60 + 70,
    homework: [{ subjectId: null, title: 'Project', minutes: 120 }],
    covered: [],
    backlog,
  })
  expect(plan.missedHomeworkMinutes).toBeGreaterThan(0)
  expect(plan.entries.length).toBeGreaterThan(0)
  expect(plan.entries.at(-1)!.endMin).toBeLessThanOrEqual(20 * 60 + 70)
})

test('an empty window produces no plan instead of a midnight session', () => {
  const plan = buildEveningPlan({
    date: day,
    freeFrom: 21 * 60,
    freeUntil: 21 * 60 + 10,
    homework: [{ subjectId: null, title: 'Work', minutes: 40 }],
    covered: [],
    backlog,
  })
  expect(plan.entries).toEqual([])
  expect(plan.missedHomeworkMinutes).toBe(40)
})

test('backlog weighs overdue work, unread chapters and a near exam', () => {
  const result = backlogOf({
    tasks: [
      { subjectId: 'm', dueDate: '2026-11-20', done: false },
      { subjectId: 'm', dueDate: '2026-11-20', done: true },
      { subjectId: 's', dueDate: '2026-11-18', done: false },
      { subjectId: 's', dueDate: '2026-12-30', done: false },
    ],
    today: day,
    subjects: [
      {
        id: 'm',
        name: 'Mathematics',
        examDate: '2026-11-26',
        chaptersTotal: 10,
        chaptersDone: 4,
      },
      {
        id: 's',
        name: 'Science',
        examDate: '',
        chaptersTotal: 8,
        chaptersDone: 8,
      },
    ],
    chaptersLeft: 6,
  })
  expect(result.overdueTasks).toBe(2)
  expect(result.chaptersLeft).toBe(6)
  expect(result.nearestExamInDays).toBe(3)
  // Maths is first: six chapters left and an exam in three days. Science has no
  // chapters left, so only its one overdue task keeps it in the list.
  expect(result.subjects[0]!.subjectId).toBe('m')
  expect(result.subjects.find((subject) => subject.subjectId === 's')?.weight).toBe(2)
})
