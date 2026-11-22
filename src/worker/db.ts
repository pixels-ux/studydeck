import type {
  Entry,
  EntryKind,
  Note,
  Plan,
  Priority,
  Profile,
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
  `CREATE TABLE IF NOT EXISTS syllabus_progress (
    owner_sub TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    chapter TEXT NOT NULL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (owner_sub, subject_id, chapter)
  )`,
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

const ready = new WeakMap<SqlDatabase, Promise<void>>()
export function ensureSchema(db: SqlDatabase): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = db
      .batch(schema.map((sql) => db.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        ready.delete(db)
        throw error
      })
    ready.set(db, pending)
  }
  return pending
}

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
