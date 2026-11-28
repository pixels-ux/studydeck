import { curriculumFor } from '../shared/curriculum'
import type { Entry, EntryInput, SetupPayload, Subject } from '../shared/types'
import { buildRevisionPlan } from './plan'
import { examDatesFromTests } from './schoolTimetable'
import { subjectHealth } from './subjectHealth'
import type { TimetablePeriod } from './timetableText'

export type CoachingDraft = {
  days: number[]
  startMin: number
  endMin: number
}

export type SetupDraft = {
  classLevel: number
  /** Chosen subjects, in the order the student picked them. */
  subjectNames: string[]
  days: number[]
  /** The student's real school timetable, one period per line in the wizard. */
  periods: TimetablePeriod[]
  coaching: CoachingDraft | null
  studyHours: number
  tests: { date: string; subjects: string[] }[]
  /** First revision day, YYYY-MM-DD. */
  from: string
}

/** Subject keys only exist inside a setup payload; the API resolves them on save. */
export const subjectKeys = (names: string[]) => names.map((_, index) => `s${index}`)

/** Longest period, used for the profile fields the timetable is built from. */
function typicalPeriod(periods: TimetablePeriod[]): number {
  if (!periods.length) return 45
  const lengths = periods.map((period) => period.endMin - period.startMin)
  return Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length)
}

/**
 * Turns the wizard's answers into the payload `/api/setup` stores. The school
 * blocks are exactly the timetable the student typed, repeated on each school
 * day, plus their coaching days. Nothing is guessed from a start and end time.
 */
export function buildSetupPayload(draft: SetupDraft): SetupPayload {
  const keys = subjectKeys(draft.subjectNames)
  const keyByName = new Map(
    draft.subjectNames.map((name, index) => [name.toLowerCase(), keys[index]!]),
  )
  const named = draft.subjectNames.map((name, index) => ({
    key: keys[index]!,
    name,
  }))
  const colors = new Map(
    curriculumFor(draft.classLevel).map((subject) => [subject.name, subject.color]),
  )
  const examDates = examDatesFromTests(
    named,
    draft.tests.map((test) => ({ date: test.date, subjectNames: test.subjects })),
  )
  const subjects = named.map(({ key, name }) => ({
    key,
    name,
    color: colors.get(name) ?? '#5f6d5f',
    teacher: '',
    examDate: examDates[key] ?? '',
  }))

  const regular: EntryInput[] = []
  for (const day of [...draft.days].sort((a, b) => a - b)) {
    for (const period of draft.periods) {
      const key = keyByName.get(period.subjectName.toLowerCase())
      if (!key) continue
      regular.push({
        subjectId: key,
        title: period.subjectName,
        kind: 'class',
        plan: 'regular',
        day,
        startMin: period.startMin,
        endMin: period.endMin,
        room: '',
        date: '',
      })
    }
    if (draft.coaching && draft.coaching.days.includes(day)) {
      regular.push({
        subjectId: null,
        title: 'Coaching',
        kind: 'class',
        plan: 'regular',
        day,
        startMin: draft.coaching.startMin,
        endMin: draft.coaching.endMin,
        room: '',
        date: '',
      })
    }
  }

  const planSubjects: Subject[] = subjects.map((subject, index) => ({
    id: subject.key,
    name: subject.name,
    color: subject.color,
    teacher: subject.teacher,
    examDate: subject.examDate,
    createdAt: index,
  }))
  const planEntries: Entry[] = regular.map((entry, index) => ({
    ...entry,
    id: `r${index}`,
  }))
  // Nothing is ticked or handed in yet, so the score weighs each chosen
  // subject by its chapters and its exam date alone.
  const health = subjectHealth({
    subjects: planSubjects,
    syllabus: [],
    tasks: [],
    classLevel: draft.classLevel,
    today: draft.from,
  })
  const revision = buildRevisionPlan({
    subjects: planSubjects,
    regular: planEntries,
    health,
    from: draft.from,
    hoursPerDay: draft.studyHours,
    includeWeekends: true,
  })

  const starts = draft.periods.map((period) => period.startMin)
  const ends = draft.periods.map((period) => period.endMin)
  const schoolStart = starts.length ? Math.min(...starts) : 8 * 60
  const schoolEnd = ends.length ? Math.max(...ends) : 14 * 60 + 30

  return {
    classLevel: draft.classLevel,
    schoolDays: draft.days,
    schoolStart,
    schoolEnd,
    periodLength: typicalPeriod(draft.periods),
    studyHours: draft.studyHours,
    subjects,
    regular,
    revision: revision.entries,
  }
}
