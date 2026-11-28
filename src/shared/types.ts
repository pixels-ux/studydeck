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

/** A prompt the student saved, to run over their own note or material. */
export type AiAction = {
  id: string
  name: string
  prompt: string
  createdAt: number
  updatedAt: number
}

export type AiActionInput = {
  name: string
  prompt: string
}

export type SyllabusTick = {
  subjectId: string
  chapter: string
  /** When the chapter was last ticked, in ms; absent in older backups. */
  tickedAt?: number
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
  /** True when the paragraph shares no word with the query. */
  byMeaning: boolean
}

export type AiState = {
  enabled: boolean
  remaining: number
  limit: number
  /** Which service answers, e.g. "Ollama"; null when the desk is off. */
  provider: string | null
  model: string | null
}

/** One answer on a flashcard: four buttons, each with its own next date. */
export type ReviewResult = 'again' | 'hard' | 'good' | 'easy'

/** A card in today's queue, with what the schedule knows about it. */
export type ReviewCard = {
  noteId: string
  noteTitle: string
  subjectId: string | null
  /** The notebook the deck lives in: the queue draws from every book. */
  notebookId: string
  notebookName: string
  /** A stable handle for the card inside its deck. */
  key: string
  question: string
  answer: string
  dueDate: string
  intervalDays: number
  ease: number
  lapses: number
  lastResult: ReviewResult | ''
  reviewedAt: number
  /** True for a card that has never been answered. */
  fresh: boolean
}

/** The record the review answers build up, shown on the Review page. */
export type ReviewStats = {
  /** Days in a row with at least one answer, ending today or yesterday. */
  streak: number
  bestStreak: number
  /** Days in the last 30, before today, that had no answers. */
  missedDays: number
  answeredToday: number
  /** Cards recalled (Good or Easy) as a percentage of the last 30 days. */
  recalled: number
  /** Answers given in the last 30 days. */
  answers: number
  /** Every answer ever given in this notebook. */
  total: number
}

/** One deck and how its cards feed the daily queue. */
export type ReviewDeck = {
  noteId: string
  noteTitle: string
  subjectId: string | null
  /** Answered cards whose due date has arrived. */
  due: number
  /** Cards never answered, which the queue treats as due. */
  fresh: number
  /** Every distinct card in the deck. */
  total: number
  /** The first future day one of its cards comes back, or "". */
  nextDue: string
}

/** Flashcards whose last answer was Again, counted for one subject. */
export type MistakeCount = {
  subjectId: string | null
  cards: number
}

/** How much review work is waiting, for Today and the rail. */
export type ReviewSummary = {
  due: number
  fresh: number
  total: number
  /** The first future day a card comes back, or "" when none is scheduled. */
  nextDue: string
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

/** A separate book: its own timetable, work, notes and material. */
export type Notebook = {
  id: string
  name: string
  createdAt: number
}

/** One copy Studydeck wrote on its own, as Settings lists it. */
export type BackupEntry = {
  /** The name inside the backups folder, and the handle a restore uses. */
  name: string
  /** When the copy was written, in milliseconds. */
  writtenAt: number
  bytes: number
  /** The names of the notebooks in it, in the order the copy holds them. */
  notebooks: string[]
  /** What it holds, e.g. "2 notebooks · 14 notes". */
  summary: string
}

export type WorkspaceData = {
  /** Every notebook on this computer, and the one being looked at. */
  notebooks: Notebook[]
  notebookId: string
  subjects: Subject[]
  entries: Entry[]
  tasks: Task[]
  /** Saved day check-ins, newest 60, which the week in review reads. */
  days: DayLog[]
  notes: Note[]
  /** Saved prompts, ready to run over a note or a subject's material. */
  actions: AiAction[]
  /** NCERT chapters the student has ticked off. */
  syllabus: SyllabusTick[]
  /** Flashcards due today, and how many exist in the notebook. */
  review: ReviewSummary
  /** Missed flashcards per subject, which the behind-score weighs. */
  mistakes: MistakeCount[]
  /** The streak and recall record built from your answers. */
  reviewStats: ReviewStats
  /** Material the student added to the library. */
  sources: Source[]
  /** Saved questions and answers about that material. */
  library: LibraryMessage[]
  profile: Profile | null
  ai: AiState
}

