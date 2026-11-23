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

/** One piece of study material the student brings in: a chapter, an article. */
export type Source = {
  id: string
  subjectId: string | null
  title: string
  /** Where it came from, e.g. "Pasted" or a file name. */
  origin: string
  body: string
  createdAt: number
  updatedAt: number
}

export type SourceInput = {
  subjectId: string | null
  title: string
  origin: string
  body: string
}

/** A material item an answer leaned on, numbered as the model saw it. */
export type Citation = {
  index: number
  sourceId: string
  sourceTitle: string
}

export type LibraryMessage = {
  id: string
  subjectId: string | null
  role: 'student' | 'assistant'
  body: string
  citations: Citation[]
  createdAt: number
}

export type HomeworkSource = 'school' | 'coaching'

/** One homework item the student names, with how much work it is. */
export type DayHomework = {
  id: string
  subjectId: string | null
  source: HomeworkSource
  title: string
  /** Estimated minutes. 0 means "nothing assigned". */
  minutes: number
}

/** What one school period covered that day. */
export type DayCovered = {
  subjectId: string | null
  title: string
  topic: string
}

export type DayCoaching = {
  attending: boolean
  startMin: number
  endMin: number
  topic: string
}

/** One day's check-in: what was taught, homework, and the evening window. */
export type DayLog = {
  date: string
  school: DayCovered[]
  coaching: DayCoaching | null
  homework: DayHomework[]
  freeFrom: number
  freeUntil: number
  /** The AI's comment on the day, empty until it is asked for. */
  brief: string
  updatedAt: number
}

export type LibrarySearchHit = {
  sourceId: string
  sourceTitle: string
  snippet: string
}

export type AiState = {
  enabled: boolean
  remaining: number
  limit: number
  /** Which service answers, e.g. "Ollama"; null when the desk is off. */
  provider: string | null
  model: string | null
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
  /** Material the student added to the library. */
  sources: Source[]
  /** Saved questions and answers about that material. */
  library: LibraryMessage[]
  profile: Profile | null
  ai: AiState
}

