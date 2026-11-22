import { curriculumFor } from '../shared/curriculum'
import type { Entry, SetupPayload, Subject } from '../shared/types'
import { buildRevisionPlan } from './plan'
import { buildSchoolTimetable, examDatesFromTests } from './schoolTimetable'

export type SetupDraft = {
  classLevel: number
  /** Chosen subjects, in the order the student picked them. */
  subjectNames: string[]
  days: number[]
  /** Minutes from midnight. */
  start: number
  end: number
  periodLength: number
  studyHours: number
  tests: { date: string; subjects: string[] }[]
  /** First revision day, YYYY-MM-DD. */
  from: string
}

const BREAK_AFTER = 4
const BREAK_LENGTH = 30

/** Subject keys only exist inside a setup payload; the API resolves them on save. */
export const subjectKeys = (names: string[]) => names.map((_, index) => `s${index}`)

/**
 * Turns the wizard's answers into the payload `/api/setup` stores. It builds
 * the timetable itself, so every entry is keyed by `SetupSubject.key` and can
 * never drift onto a subject name.
 */
export function buildSetupPayload(draft: SetupDraft): SetupPayload {
  const keys = subjectKeys(draft.subjectNames)
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

  const school = buildSchoolTimetable({
    subjects: named,
    days: draft.days,
    start: draft.start,
    end: draft.end,
    periodLength: draft.periodLength,
    breakAfter: BREAK_AFTER,
    breakLength: BREAK_LENGTH,
  })

  const planSubjects: Subject[] = subjects.map((subject, index) => ({
    id: subject.key,
    name: subject.name,
    color: subject.color,
    teacher: subject.teacher,
    examDate: subject.examDate,
    createdAt: index,
  }))
  const planEntries: Entry[] = school.entries.map((entry, index) => ({
    ...entry,
    id: `r${index}`,
  }))
  const revision = buildRevisionPlan({
    subjects: planSubjects,
    regular: planEntries,
    from: draft.from,
    hoursPerDay: draft.studyHours,
    includeWeekends: true,
  })

  return {
    classLevel: draft.classLevel,
    schoolDays: draft.days,
    schoolStart: draft.start,
    schoolEnd: draft.end,
    periodLength: draft.periodLength,
    studyHours: draft.studyHours,
    subjects,
    regular: school.entries,
    revision: revision.entries,
  }
}
