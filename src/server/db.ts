import type {
  AiAction,
  Citation,
  DayCoaching,
  DayCovered,
  DayHomework,
  DayLog,
  Entry,
  EntryKind,
  LibraryMessage,
  Note,
  Notebook,
  Plan,
  Priority,
  Profile,
  Source,
  Subject,
  Task,
} from '../shared/types'
import type { SqlDatabase } from './sql'

const schema = [
  `CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    teacher TEXT NOT NULL DEFAULT '',
    exam_date TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS subjects_owner ON subjects(owner_sub, created_at)`,
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    subject_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    day INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    room TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS entries_owner_plan ON entries(owner_sub, plan, day, start_min)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    subject_id TEXT,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',
    done INTEGER NOT NULL DEFAULT 0,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(owner_sub, done, due_date)`,
  `CREATE TABLE IF NOT EXISTS study_notes (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    subject_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS study_notes_owner ON study_notes(owner_sub, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    owner_sub TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_sub, day)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_keys (
    owner_sub TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    subject_id TEXT,
    title TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sources_owner ON sources(owner_sub, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS library_messages (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    subject_id TEXT,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS library_messages_owner ON library_messages(owner_sub, subject_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_actions (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_actions_owner ON ai_actions(owner_sub, created_at)`,
  `CREATE TABLE IF NOT EXISTS day_logs (
    owner_sub TEXT NOT NULL,
    date TEXT NOT NULL,
    school TEXT NOT NULL DEFAULT '[]',
    coaching TEXT NOT NULL DEFAULT 'null',
    homework TEXT NOT NULL DEFAULT '[]',
    free_from INTEGER NOT NULL,
    free_until INTEGER NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_sub, date)
  )`,
  `CREATE TABLE IF NOT EXISTS syllabus_progress (
    owner_sub TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    chapter TEXT NOT NULL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (owner_sub, subject_id, chapter)
  )`,
  `CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    owner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notebooks_owner ON notebooks(owner_sub, created_at)`,
  `CREATE TABLE IF NOT EXISTS profiles (
    owner_sub TEXT PRIMARY KEY,
    class_level INTEGER NOT NULL,
    school_days TEXT NOT NULL,
    school_start INTEGER NOT NULL,
    school_end INTEGER NOT NULL,
    period_length INTEGER NOT NULL,
    study_hours REAL NOT NULL,
    setup_at INTEGER NOT NULL
  )`,
]

/** The app trusts this computer; a notebook is a second book, not an account. */
export const BASE_OWNER = 'local'

/** Rows belong to one notebook, so every existing owner check scopes them. */
export const scopedOwner = (notebookId: string): string =>
  `${BASE_OWNER}:${notebookId}`

/** Tables whose rows move with their notebook. Profile and AI settings stay. */
export const NOTEBOOK_TABLES = [
  'subjects',
  'entries',
  'tasks',
  'study_notes',
  'ai_actions',
  'sources',
  'library_messages',
  'day_logs',
  'syllabus_progress',
]

/**
 * An earlier copy of Studydeck has rows but no notebook, so the first run after
 * this version gathers them into one notebook instead of hiding them.
 */
export async function migrate(db: SqlDatabase): Promise<void> {
  const existing = await db
    .prepare(
      'SELECT id FROM notebooks WHERE owner_sub = ? ORDER BY created_at ASC LIMIT 1',
    )
    .bind(BASE_OWNER)
    .first<{ id: string }>()
  if (existing) return

  const id = crypto.randomUUID()
  const statements = [
    db
      .prepare(
        'INSERT INTO notebooks (id, owner_sub, name, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, BASE_OWNER, 'My notebook', Date.now()),
    ...NOTEBOOK_TABLES.map((table) =>
      db
        .prepare(`UPDATE ${table} SET owner_sub = ? WHERE owner_sub = ?`)
        .bind(scopedOwner(id), BASE_OWNER),
    ),
  ]
  await db.batch(statements)
}

const ready = new WeakMap<SqlDatabase, Promise<void>>()
export function ensureSchema(db: SqlDatabase): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .batch(schema.map((sql) => db.prepare(sql)))
      .then(() => migrate(db))
      .catch((error) => {
        ready.delete(db)
        throw error
      })
    ready.set(db, pending)
  }
  return pending
}

export type NotebookRow = { id: string; name: string; created_at: number }
export const mapNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
})

export type SubjectRow = {
  id: string
  name: string
  color: string
  teacher: string
  exam_date: string
  created_at: number
}
export const mapSubject = (row: SubjectRow): Subject => ({
  id: row.id,
  name: row.name,
  color: row.color,
  teacher: row.teacher,
  examDate: row.exam_date,
  createdAt: row.created_at,
})

export type EntryRow = {
  id: string
  subject_id: string | null
  title: string
  kind: string
  day: number
  start_min: number
  end_min: number
  room: string
  plan: string
  date: string
}
export const mapEntry = (row: EntryRow): Entry => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  kind: row.kind as EntryKind,
  day: row.day,
  startMin: row.start_min,
  endMin: row.end_min,
  room: row.room,
  plan: row.plan as Plan,
  date: row.date,
})

export type TaskRow = {
  id: string
  subject_id: string | null
  title: string
  due_date: string
  priority: string
  done: number
  details: string
  created_at: number
}
export const mapTask = (row: TaskRow): Task => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  dueDate: row.due_date,
  priority: row.priority as Priority,
  done: row.done === 1,
  details: row.details,
  createdAt: row.created_at,
})

export type NoteRow = {
  id: string
  subject_id: string | null
  title: string
  body: string
  created_at: number
  updated_at: number
}
export const mapNote = (row: NoteRow): Note => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export type AiActionRow = {
  id: string
  name: string
  prompt: string
  created_at: number
  updated_at: number
}
export const mapAiAction = (row: AiActionRow): AiAction => ({
  id: row.id,
  name: row.name,
  prompt: row.prompt,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export type SourceRow = {
  id: string
  subject_id: string | null
  title: string
  origin: string
  body: string
  created_at: number
  updated_at: number
}
export const mapSource = (row: SourceRow): Source => ({
  id: row.id,
  subjectId: row.subject_id,
  title: row.title,
  origin: row.origin,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export type LibraryMessageRow = {
  id: string
  subject_id: string | null
  role: string
  body: string
  citations: string
  created_at: number
}

/** Citations are stored as JSON, so a damaged row must not break the load. */
function readCitations(raw: string): Citation[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const index = record.index
      if (
        typeof index !== 'number' ||
        typeof record.sourceId !== 'string' ||
        typeof record.sourceTitle !== 'string'
      )
        return []
      return [
        {
          index,
          sourceId: record.sourceId,
          sourceTitle: record.sourceTitle,
        },
      ]
    })
  } catch {
    return []
  }
}

export const mapLibraryMessage = (row: LibraryMessageRow): LibraryMessage => ({
  id: row.id,
  subjectId: row.subject_id,
  role: row.role === 'assistant' ? 'assistant' : 'student',
  body: row.body,
  citations: readCitations(row.citations),
  createdAt: row.created_at,
})

export type DayLogRow = {
  date: string
  school: string
  coaching: string
  homework: string
  free_from: number
  free_until: number
  brief: string
  updated_at: number
}

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

/** A damaged or hand-edited row loads as an empty day, never a crash. */
export function mapDayLog(row: DayLogRow): DayLog {
  const schoolRaw = json(row.school)
  const school: DayCovered[] = Array.isArray(schoolRaw)
    ? schoolRaw.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const record = item as Record<string, unknown>
        return [
          {
            subjectId:
              typeof record.subjectId === 'string' ? record.subjectId : null,
            title: text(record.title, 80),
            topic: text(record.topic, 300),
          },
        ]
      })
    : []

  const coachingRaw = json(row.coaching)
  let coaching: DayCoaching | null = null
  if (coachingRaw && typeof coachingRaw === 'object') {
    const record = coachingRaw as Record<string, unknown>
    coaching = {
      attending: record.attending === true,
      startMin:
        typeof record.startMin === 'number' ? record.startMin : 0,
      endMin: typeof record.endMin === 'number' ? record.endMin : 0,
      topic: text(record.topic, 300),
    }
  }

  const homeworkRaw = json(row.homework)
  const homework: DayHomework[] = Array.isArray(homeworkRaw)
    ? homeworkRaw.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const record = item as Record<string, unknown>
        return [
          {
            id: text(record.id, 64) || crypto.randomUUID(),
            subjectId:
              typeof record.subjectId === 'string' ? record.subjectId : null,
            source: record.source === 'coaching' ? 'coaching' : 'school',
            title: text(record.title, 120),
            minutes:
              typeof record.minutes === 'number' ? record.minutes : 0,
          },
        ]
      })
    : []

  return {
    date: row.date,
    school,
    coaching,
    homework,
    freeFrom: row.free_from,
    freeUntil: row.free_until,
    brief: row.brief,
    updatedAt: row.updated_at,
  }
}

export type ProfileRow = {
  class_level: number
  school_days: string
  school_start: number
  school_end: number
  period_length: number
  study_hours: number
  setup_at: number
}
export const mapProfile = (row: ProfileRow): Profile => ({
  classLevel: row.class_level,
  schoolDays: row.school_days
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
  schoolStart: row.school_start,
  schoolEnd: row.school_end,
  periodLength: row.period_length,
  studyHours: row.study_hours,
  setupAt: row.setup_at,
})

export async function readProfile(
  db: SqlDatabase,
  owner: string,
): Promise<Profile | null> {
  const row = await db
    .prepare(
      'SELECT class_level, school_days, school_start, school_end, period_length, study_hours, setup_at FROM profiles WHERE owner_sub = ?',
    )
    .bind(owner)
    .first<ProfileRow>()
  return row ? mapProfile(row) : null
}
