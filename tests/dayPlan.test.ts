import { expect, test } from 'bun:test'
import {
  backlogOf,
  breakLengthFor,
  buildEveningPlan,
  planWithout,
  recoverableBlocks,
} from '../src/client/dayPlan'
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

test('skipped blocks can be pulled into tonight, and one that does not fit is reported', () => {
  const plan = buildEveningPlan({
    date: day,
    freeFrom: 17 * 60,
    freeUntil: 17 * 60 + 70,
    homework: [],
    covered: [],
    backlog,
    recovered: [
      { id: 'a', subjectId: 's1', title: 'Review · Science: Refraction', minutes: 40 },
      { id: 'b', subjectId: 's2', title: 'Review · Mathematics: Circles', minutes: 60 },
    ],
  })
  expect(plan.pulledIds).toEqual(['a'])
  expect(plan.missedRecoveryMinutes).toBe(60)
  expect(plan.entries[0]!.title).toBe('Review · Science: Refraction')
  expect(plan.studyMinutes).toBe(40)
  expect(plan.entries.at(-1)!.endMin).toBeLessThanOrEqual(17 * 60 + 70)
  expect(plan.entries.every((entry) => entry.date === day)).toBe(true)
})

test('a recovered block still yields to homework with a deadline', () => {
  const plan = buildEveningPlan({
    date: day,
    freeFrom: 17 * 60,
    freeUntil: 17 * 60 + 60,
    homework: [{ subjectId: 's1', title: 'Algebra problems', minutes: 45 }],
    covered: [],
    backlog,
    recovered: [
      { id: 'a', subjectId: 's2', title: 'Review · Science: Refraction', minutes: 40 },
    ],
  })
  expect(plan.pulledIds).toEqual([])
  expect(plan.missedRecoveryMinutes).toBe(40)
  expect(plan.entries[0]!.title).toBe('Algebra problems')
})

test('only skipped blocks from the last week are offered back', () => {
  const entry = (
    id: string,
    date: string,
    values: { kind?: 'study' | 'break'; plan?: 'intensive' | 'regular'; startMin?: number } = {},
  ) => ({
    id,
    subjectId: null,
    title: id,
    kind: values.kind ?? ('study' as const),
    day: 2,
    startMin: values.startMin ?? 1020,
    endMin: (values.startMin ?? 1020) + 20,
    room: '',
    plan: values.plan ?? ('intensive' as const),
    date,
  })
  const blocks = recoverableBlocks(
    [
      entry('edge', '2026-11-19'),
      entry('old', '2026-11-18'),
      entry('today', '2026-11-26'),
      entry('late', '2026-11-25', { startMin: 1080 }),
      entry('early', '2026-11-25', { startMin: 960 }),
      entry('break', '2026-11-24', { kind: 'break' }),
      entry('class', '2026-11-24', { plan: 'regular' }),
    ],
    '2026-11-26',
  )
  // A week back is still offered; anything older, today and non-study is not.
  expect(blocks.map((block) => block.id)).toEqual(['early', 'late', 'edge'])
})

test('carried and dropped blocks leave their old day, and neighbours stay', () => {
  const entry = (id: string, date: string, title: string) => ({
    id,
    subjectId: null,
    title,
    kind: 'study' as const,
    day: 2,
    startMin: 1020,
    endMin: 1040,
    room: '',
    plan: 'intensive' as const,
    date,
  })
  const days = planWithout(
    [
      entry('a', '2026-11-25', 'Refraction'),
      entry('b', '2026-11-25', 'Human eye'),
      entry('c', '2026-11-24', 'Light'),
      entry('d', '2026-11-24', 'Sound'),
      entry('e', '2026-11-23', 'Echoes'),
    ],
    new Set(['a', 'c']),
  )
  // The untouched day is not rewritten, so its blocks are not churned.
  expect(days.map((day) => day.date)).toEqual(['2026-11-24', '2026-11-25'])
  expect(days[0]!.entries.map((item) => item.title)).toEqual(['Sound'])
  expect(days[1]!.entries.map((item) => item.title)).toEqual(['Human eye'])
  expect(days[1]!.entries[0]!.date).toBe('2026-11-25')
  expect('id' in days[1]!.entries[0]!).toBe(false)
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
  expect(plan.missedRecoveryMinutes).toBe(0)
  expect(plan.pulledIds).toEqual([])
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
