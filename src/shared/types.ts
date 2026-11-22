export type Plan = 'regular' | 'intensive'
export type EntryKind = 'class' | 'study' | 'exam' | 'break'
export type Priority = 'low' | 'normal' | 'high'

export type Subject = {
  id: string
  name: string
  color: string
  teacher: string
  /** YYYY-MM-DD, empty when no exam is scheduled. */
  examDate: string
  createdAt: number
}

export type SubjectInput = {
  name: string
  color: string
  teacher: string
  examDate: string
}

export type Entry = {
  id: string
  subjectId: string | null
  title: string
  kind: EntryKind
  /** Monday = 0 … Sunday = 6. */
  day: number
  startMin: number
  endMin: number
  room: string
  plan: Plan
  /** YYYY-MM-DD for revision-plan blocks, empty for the weekly timetable. */
  date: string
}

export type EntryInput = Omit<Entry, 'id'>

export type Task = {
  id: string
  subjectId: string | null
  title: string
  /** YYYY-MM-DD, empty when there is no deadline. */
  dueDate: string
  priority: Priority
  done: boolean
  details: string
  createdAt: number
}

export type TaskInput = {
  subjectId: string | null
  title: string
  dueDate: string
  priority: Priority
  details: string
  done: boolean
}

export type Note = {
  id: string
  subjectId: string | null
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

export type NoteInput = {
  subjectId: string | null
  title: string
  body: string
}

export type SyllabusTick = {
  subjectId: string
  chapter: string
}

export type AiState = {
  enabled: boolean
  remaining: number
  limit: number
}

export type Profile = {
  classLevel: number
  /** School days as Monday = 0 … Sunday = 6. */
  schoolDays: number[]
  schoolStart: number
  schoolEnd: number
  periodLength: number
  studyHours: number
  setupAt: number
}

/** A subject as it arrives from the class-setup wizard, with a temporary key. */
export type SetupSubject = {
  key: string
  name: string
  color: string
  teacher: string
  examDate: string
}

export type SetupPayload = {
  classLevel: number
  schoolDays: number[]
  schoolStart: number
  schoolEnd: number
  periodLength: number
  studyHours: number
  subjects: SetupSubject[]
  /** Entry subjectIds reference SetupSubject.key and are resolved on save. */
  regular: EntryInput[]
  revision: EntryInput[]
}

export type WorkspaceData = {
  subjects: Subject[]
  entries: Entry[]
  tasks: Task[]
  notes: Note[]
  /** NCERT chapters the student has ticked off. */
  syllabus: SyllabusTick[]
  profile: Profile | null
  ai: AiState
}

export type Session = {
  user: { sub: string; name?: string; email?: string } | null
  mode: 'local' | 'freebuff' | 'setup'
  database: boolean
}
