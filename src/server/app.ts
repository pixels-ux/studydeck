import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { syllabusBrief, unitsFor } from '../shared/curriculum.ts'
import type {
  Citation,
  DayCovered,
  DayHomework,
  DayLog,
  Notebook,
  EntryKind,
  EntryInput,
  NoteInput,
  Plan,
  Priority,
  LibrarySearchHit,
  SourceInput,
  SubjectInput,
  TaskInput,
} from '../shared/types'
import {
  AI_DAILY_LIMIT,
  answerFromMaterial,
  askNotes,
  dayBrief,
  consumeAi,
  practiceQuestions,
  revisionCards,
  revisionSlides,
  summariseNotes,
  usedAi,
  type NoteSource,
} from './ai.ts'
import { clearAiKey, effectiveProvider, readAiKey, saveAiKey } from './aiSettings.ts'
import type { Env } from './env'
import { documentKind, extractDocument } from './extract.ts'
import { calendarFileName, timetableFile } from './ics.ts'
import {
  buildSemanticIndex,
  chunkSource,
  MAX_SOURCE_CHARS,
  retrieve,
  search,
  type SemanticIndex,
} from './library.ts'
import { AiError, PROVIDER_IDS, PROVIDERS, providerFromSettings } from './providers.ts'
import type { SqlDatabase, SqlStatement } from './sql'
import {
  BASE_OWNER,
  ensureSchema,
  mapDayLog,
  mapEntry,
  mapLibraryMessage,
  mapNote,
  mapNotebook,
  mapProfile,
  mapSource,
  mapSubject,
  mapTask,
  NOTEBOOK_TABLES,
  readProfile,
  scopedOwner,
  type DayLogRow,
  type EntryRow,
  type LibraryMessageRow,
  type NoteRow,
  type NotebookRow,
  type ProfileRow,
  type SourceRow,
  type SubjectRow,
  type TaskRow,
} from './db.ts'

/** One person uses one copy of Studydeck, so there is a single workspace. */

type AppContext = {
  Variables: { db: SqlDatabase; owner: string; notebook: Notebook }
}

/** A write must come from this origin, so another tab cannot post behind us. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return !origin || origin === new URL(request.url).origin
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const KINDS: EntryKind[] = ['class', 'study', 'exam', 'break']
const PLANS: Plan[] = ['regular', 'intensive']
const PRIORITIES: Priority[] = ['low', 'normal', 'high']

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

function whole(value: unknown, min: number, max: number): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

const identifier = (value: unknown): string | null =>
  typeof value === 'string' && ID_PATTERN.test(value) ? value : null

function optionalIdentifier(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return identifier(value) ?? undefined
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

/** Monday = 0 … Sunday = 6 for a calendar date. */
function dayOfDate(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`)
  return (parsed.getUTCDay() + 6) % 7
}

function parseEntry(body: Record<string, unknown>): EntryInput | null {
  const kind = KINDS.find((option) => option === body.kind)
  const plan = PLANS.find((option) => option === body.plan)
  const startMin = whole(body.startMin, 0, 1439)
  const endMin = whole(body.endMin, 1, 1440)
  const subjectId = optionalIdentifier(body.subjectId)
  if (
    !kind ||
    !plan ||
    startMin === null ||
    endMin === null ||
    endMin <= startMin ||
    subjectId === undefined
  )
    return null
  const date = clean(body.date, 10)
  let day: number
  if (plan === 'intensive') {
    if (!DATE_PATTERN.test(date)) return null
    day = dayOfDate(date)
  } else {
    const weekday = whole(body.day, 0, 6)
    if (weekday === null) return null
    day = weekday
  }
  const fallback =
    kind === 'break'
      ? 'Break'
      : kind === 'exam'
        ? 'Exam'
        : kind === 'study'
          ? 'Study block'
          : 'Class'
  return {
    subjectId,
    kind,
    plan,
    day,
    startMin,
    endMin,
    date: plan === 'intensive' ? date : '',
    title: clean(body.title, 60) || fallback,
    room: clean(body.room, 40),
  }
}

function parseSubject(body: Record<string, unknown>): SubjectInput | null {
  const name = clean(body.name, 40)
  const examDate = clean(body.examDate, 10)
  const color = clean(body.color, 7)
  if (!name) return null
  if (examDate && !DATE_PATTERN.test(examDate)) return null
  return {
    name,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3f6b52',
    teacher: clean(body.teacher, 40),
    examDate,
  }
}

function parseTask(body: Record<string, unknown>): TaskInput | null {
  const title = clean(body.title, 120)
  const dueDate = clean(body.dueDate, 10)
  const priority = PRIORITIES.find((option) => option === body.priority)
  const subjectId = optionalIdentifier(body.subjectId)
  if (!title || !priority || subjectId === undefined) return null
  if (dueDate && !DATE_PATTERN.test(dueDate)) return null
  return {
    title,
    subjectId,
    dueDate,
    priority,
    details: clean(body.details, 500),
    done: body.done === true,
  }
}

function parseNote(body: Record<string, unknown>): NoteInput | null {  if (typeof body.body === 'string' && body.body.length > 8000) return null
  const noteBody = typeof body.body === 'string' ? body.body : ''
  const subjectId = optionalIdentifier(body.subjectId)
  if (subjectId === undefined) return null
  const title =
    clean(body.title, 120) ||
    noteBody
      .split('\n')[0]!
      .trim()
      .slice(0, 80) ||
    'Untitled note'
  if (!noteBody.trim()) return null
  return { subjectId, title, body: noteBody }
}

/** Material the student brings in: pasted text, or a text file they chose. */
function parseSource(body: Record<string, unknown>): SourceInput | null {
  if (typeof body.body !== 'string' || body.body.length > MAX_SOURCE_CHARS)
    return null
  const sourceBody = body.body
  const subjectId = optionalIdentifier(body.subjectId)
  if (subjectId === undefined || !sourceBody.trim()) return null
  const title =
    clean(body.title, 120) ||
    sourceBody
      .split('\n')[0]!
      .trim()
      .slice(0, 80) ||
    'Untitled material'
  return {
    subjectId,
    title,
    origin: clean(body.origin, 120) || 'Pasted',
    body: sourceBody,
  }
}

/** A day's check-in: what was taught, homework, and the evening window. */
function parseDayLog(
  body: Record<string, unknown>,
): Omit<DayLog, 'updatedAt'> | null {
  const date = clean(body.date, 10)
  if (!DATE_PATTERN.test(date)) return null
  const freeFrom = whole(body.freeFrom, 0, 1439)
  const freeUntil = whole(body.freeUntil, 1, 1440)
  if (freeFrom === null || freeUntil === null || freeUntil <= freeFrom)
    return null

  const schoolList = Array.isArray(body.school) ? body.school : null
  const homeworkList = Array.isArray(body.homework) ? body.homework : null
  if (
    !schoolList ||
    schoolList.length > 20 ||
    !homeworkList ||
    homeworkList.length > 40
  )
    return null

  const school: DayCovered[] = []
  for (const item of schoolList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const subjectId = optionalIdentifier(record.subjectId)
    const title = clean(record.title, 80)
    if (subjectId === undefined || !title) return null
    school.push({ subjectId, title, topic: clean(record.topic, 300) })
  }

  const homework: DayHomework[] = []
  for (const item of homeworkList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const subjectId = optionalIdentifier(record.subjectId)
    const minutes = whole(record.minutes, 0, 600)
    const title = clean(record.title, 120)
    if (subjectId === undefined || minutes === null || !title) return null
    homework.push({
      id: identifier(record.id) ?? crypto.randomUUID(),
      subjectId,
      source: record.source === 'coaching' ? 'coaching' : 'school',
      title,
      minutes,
    })
  }

  let coaching: DayLog['coaching'] = null
  if (
    body.coaching &&
    typeof body.coaching === 'object' &&
    !Array.isArray(body.coaching)
  ) {
    const record = body.coaching as Record<string, unknown>
    const startMin = whole(record.startMin, 0, 1439)
    const endMin = whole(record.endMin, 1, 1440)
    if (startMin === null || endMin === null || endMin <= startMin) return null
    coaching = {
      attending: record.attending === true,
      startMin,
      endMin,
      topic: clean(record.topic, 300),
    }
  }

  return {
    date,
    school,
    coaching,
    homework,
    freeFrom,
    freeUntil,
    brief: clean(body.brief, 4000),
  }
}

const entryColumns =
  'id, subject_id, title, kind, day, start_min, end_min, room, plan, date'
const taskColumns =
  'id, subject_id, title, due_date, priority, done, details, created_at'
const noteColumns = 'id, subject_id, title, body, created_at, updated_at'
const sourceColumns =
  'id, subject_id, title, origin, body, created_at, updated_at'
const messageColumns =
  'id, subject_id, role, body, citations, created_at'
const dayLogColumns =
  'date, school, coaching, homework, free_from, free_until, brief, updated_at'
const TRANSFORMS = ['summary', 'questions', 'flashcards', 'slides'] as const
type Transform = (typeof TRANSFORMS)[number]

/** The note a transformation is saved under, e.g. "Flashcards · Light". */
const TRANSFORM_TITLES: Record<Transform, string> = {
  summary: 'Summary',
  questions: 'Practice questions',
  flashcards: 'Flashcards',
  slides: 'Slides',
}

/** One INSERT shared by the revision-plan and class-setup endpoints. */
function insertEntry(
  db: SqlDatabase,
  owner: string,
  entry: EntryInput,
  plan: Plan,
  subjectId: string | null,
): SqlStatement {
  return db
    .prepare(
      'INSERT INTO entries (id, owner_sub, subject_id, title, kind, day, start_min, end_min, room, plan, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      owner,
      subjectId,
      entry.title,
      entry.kind,
      entry.day,
      entry.startMin,
      entry.endMin,
      entry.room,
      plan,
      entry.date,
    )
}

/*
 * Reading a backup back in. Every row is held to the same limits as a typed
 * row, then merged with what is already here: an id that exists, a day that
 * was already checked in and a class setup that was already saved all win, and
 * nothing is ever deleted.
 */

const IMPORT_PATH = '/api/import'
const MAX_IMPORT_BYTES = 32 * 1024 * 1024
const EXTRACT_PATH = '/api/library/extract'
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_STATEMENTS = 5_000
const BACKUP_VERSION = 2
const MAX_TIME = 9_000_000_000_000
const MAX_LIBRARY_BODY = 8_000
const MAX_CHAPTER = 200

const IMPORT_FAILED = 'That file could not be read as a Studydeck backup.'

type ImportSubject = { id: string; input: SubjectInput; createdAt: number }
type ImportBlock = { id: string; input: EntryInput }
type ImportTask = { id: string; input: TaskInput; createdAt: number }
type ImportNote = {
  id: string
  input: NoteInput
  createdAt: number
  updatedAt: number
}
type ImportSource = {
  id: string
  input: SourceInput
  createdAt: number
  updatedAt: number
}
type ImportMessage = {
  id: string
  subjectId: string | null
  role: 'student' | 'assistant'
  body: string
  citations: Citation[]
  createdAt: number
}
type ImportDay = { log: Omit<DayLog, 'updatedAt'>; updatedAt: number }
type ImportTick = { subjectId: string; chapter: string; doneAt: number }
type ImportProfile = {
  classLevel: number
  schoolDays: number[]
  schoolStart: number
  schoolEnd: number
  periodLength: number
  studyHours: number
  setupAt: number
}
type Backup = {
  profile: ImportProfile | null
  subjects: ImportSubject[]
  entries: ImportBlock[]
  tasks: ImportTask[]
  notes: ImportNote[]
  sources: ImportSource[]
  library: ImportMessage[]
  days: ImportDay[]
  syllabus: ImportTick[]
}
type ImportCounts = {
  subjects: number
  entries: number
  tasks: number
  notes: number
  sources: number
  library: number
  days: number
  syllabus: number
  profile: number
}

const emptyCounts = (): ImportCounts => ({
  subjects: 0,
  entries: 0,
  tasks: 0,
  notes: 0,
  sources: 0,
  library: 0,
  days: 0,
  syllabus: 0,
  profile: 0,
})

/** A missing collection is empty; a present one must be a list of objects. */
function backupRecords(
  value: unknown,
  max: number,
): Record<string, unknown>[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > max) return null
  const rows: Record<string, unknown>[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    rows.push(item as Record<string, unknown>)
  }
  return rows
}

const stamp = (value: unknown): number | null => whole(value, 0, MAX_TIME)

/** Citations are labels here: a source that is missing is still readable. */
function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return []
  const citations: Citation[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const index = whole(record.index, 1, 99)
    const sourceId = identifier(record.sourceId)
    const sourceTitle = clean(record.sourceTitle, 120)
    if (index === null || !sourceId || !sourceTitle) continue
    if (citations.some((citation) => citation.sourceId === sourceId)) continue
    citations.push({ index, sourceId, sourceTitle })
  }
  return citations
}

function parseImportProfile(
  value: unknown,
): ImportProfile | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const classLevel = whole(record.classLevel, 6, 12)
  const schoolStart = whole(record.schoolStart, 0, 1439)
  const schoolEnd = whole(record.schoolEnd, 1, 1440)
  const periodLength = whole(record.periodLength, 20, 120)
  const studyHours =
    typeof record.studyHours === 'number' &&
    record.studyHours >= 1 &&
    record.studyHours <= 10
      ? record.studyHours
      : null
  const schoolDays = Array.isArray(record.schoolDays)
    ? record.schoolDays.filter(
        (day): day is number =>
          typeof day === 'number' &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6,
      )
    : null
  const setupAt = stamp(record.setupAt)
  if (
    classLevel === null ||
    schoolStart === null ||
    schoolEnd === null ||
    schoolEnd <= schoolStart ||
    periodLength === null ||
    studyHours === null ||
    !schoolDays ||
    schoolDays.length === 0 ||
    setupAt === null
  )
    return undefined
  return {
    classLevel,
    schoolDays: [...new Set(schoolDays)].sort((a, b) => a - b),
    schoolStart,
    schoolEnd,
    periodLength,
    studyHours,
    setupAt,
  }
}

type BackupPart = {
  /** null for a version 1 file, which has no notebook of its own. */
  notebook: { id: string; name: string; createdAt: number } | null
  backup: Backup
}

/** A version 1 file is one notebook; a version 2 file lists several. */
function parseBackup(
  body: Record<string, unknown>,
): { parts: BackupPart[]; profile: Backup['profile'] } | { error: string } {
  if (body.app !== 'Studydeck')
    return { error: 'That file was not made by Studydeck.' }
  const version = whole(body.version, 1, 99)
  if (version === null) return { error: 'That file was not made by Studydeck.' }

  if (version === 1) {
    const parsed = parseNotebookData(body)
    if ('error' in parsed) return parsed
    return {
      parts: [{ notebook: null, backup: { ...parsed.backup, profile: null } }],
      profile: parsed.backup.profile,
    }
  }
  if (version !== BACKUP_VERSION)
    return { error: 'That backup comes from a different version of Studydeck.' }

  const profile = parseImportProfile(body.profile)
  if (profile === undefined)
    return { error: 'That backup has a class setup Studydeck could not read.' }
  const list = backupRecords(body.notebooks, 20)
  if (!list || !list.length) return { error: IMPORT_FAILED }
  const parts: BackupPart[] = []
  for (const record of list) {
    const meta = record.notebook
    if (!meta || typeof meta !== 'object' || Array.isArray(meta))
      return { error: IMPORT_FAILED }
    const info = meta as Record<string, unknown>
    const id = identifier(info.id)
    const name = clean(info.name, 60)
    const createdAt = stamp(info.createdAt)
    if (!id || !name || createdAt === null) return { error: IMPORT_FAILED }
    const parsed = parseNotebookData(record)
    if ('error' in parsed) return parsed
    parts.push({
      notebook: { id, name, createdAt },
      backup: { ...parsed.backup, profile: null },
    })
  }
  return { parts, profile }
}

/** One notebook's worth of data, as a file from version 1 or 2 carries it. */
function parseNotebookData(
  body: Record<string, unknown>,
): { backup: Backup } | { error: string } {
  const subjectList = backupRecords(body.subjects, 20)
  if (!subjectList) return { error: IMPORT_FAILED }
  const subjects: ImportSubject[] = []
  for (const record of subjectList) {
    const id = identifier(record.id)
    const input = parseSubject(record)
    const createdAt = stamp(record.createdAt)
    if (!id || !input || createdAt === null || subjects.some((row) => row.id === id))
      return { error: 'That backup has a subject Studydeck could not read.' }
    subjects.push({ id, input, createdAt })
  }

  const entryList = backupRecords(body.entries, 800)
  if (!entryList) return { error: IMPORT_FAILED }
  const entries: ImportBlock[] = []
  for (const record of entryList) {
    const id = identifier(record.id)
    const input = parseEntry(record)
    if (!id || !input || entries.some((row) => row.id === id))
      return { error: 'That backup has a timetable block Studydeck could not read.' }
    entries.push({ id, input })
  }

  const taskList = backupRecords(body.tasks, 300)
  if (!taskList) return { error: IMPORT_FAILED }
  const tasks: ImportTask[] = []
  for (const record of taskList) {
    const id = identifier(record.id)
    const input = parseTask(record)
    const createdAt = stamp(record.createdAt)
    if (!id || !input || createdAt === null || tasks.some((row) => row.id === id))
      return { error: 'That backup has a task Studydeck could not read.' }
    tasks.push({ id, input, createdAt })
  }

  const noteList = backupRecords(body.notes, 200)
  if (!noteList) return { error: IMPORT_FAILED }
  const notes: ImportNote[] = []
  for (const record of noteList) {
    const id = identifier(record.id)
    const input = parseNote(record)
    const createdAt = stamp(record.createdAt)
    if (!id || !input || createdAt === null || notes.some((row) => row.id === id))
      return { error: 'That backup has a note Studydeck could not read.' }
    notes.push({
      id,
      input,
      createdAt,
      updatedAt: stamp(record.updatedAt) ?? createdAt,
    })
  }

  const sourceList = backupRecords(body.sources, 300)
  if (!sourceList) return { error: IMPORT_FAILED }
  const sources: ImportSource[] = []
  for (const record of sourceList) {
    const id = identifier(record.id)
    const input = parseSource(record)
    const createdAt = stamp(record.createdAt)
    if (!id || !input || createdAt === null || sources.some((row) => row.id === id))
      return { error: 'That backup has library material Studydeck could not read.' }
    sources.push({
      id,
      input,
      createdAt,
      updatedAt: stamp(record.updatedAt) ?? createdAt,
    })
  }

  const messageList = backupRecords(body.library, 2_000)
  if (!messageList) return { error: IMPORT_FAILED }
  const library: ImportMessage[] = []
  for (const record of messageList) {
    const id = identifier(record.id)
    const role =
      record.role === 'assistant'
        ? 'assistant'
        : record.role === 'student'
          ? 'student'
          : null
    const text = typeof record.body === 'string' ? record.body.slice(0, MAX_LIBRARY_BODY) : ''
    const subjectId = optionalIdentifier(record.subjectId)
    const createdAt = stamp(record.createdAt)
    if (
      !id ||
      !role ||
      !text.trim() ||
      subjectId === undefined ||
      createdAt === null ||
      library.some((row) => row.id === id)
    )
      return { error: 'That backup has a library message Studydeck could not read.' }
    library.push({
      id,
      subjectId,
      role,
      body: text,
      citations: parseCitations(record.citations),
      createdAt,
    })
  }

  const dayList = backupRecords(body.days, 3_660)
  if (!dayList) return { error: IMPORT_FAILED }
  const days: ImportDay[] = []
  for (const record of dayList) {
    const log = parseDayLog(record)
    const updatedAt = stamp(record.updatedAt)
    if (!log || updatedAt === null || days.some((row) => row.log.date === log.date))
      return { error: 'That backup has a day check-in Studydeck could not read.' }
    days.push({ log, updatedAt })
  }

  const tickList = backupRecords(body.syllabus, 2_000)
  if (!tickList) return { error: IMPORT_FAILED }
  const syllabus: ImportTick[] = []
  for (const record of tickList) {
    const subjectId = identifier(record.subjectId)
    const chapter = clean(record.chapter, MAX_CHAPTER)
    if (!subjectId || !chapter)
      return { error: 'That backup has a syllabus tick Studydeck could not read.' }
    syllabus.push({ subjectId, chapter, doneAt: stamp(record.doneAt) ?? Date.now() })
  }

  const profile = parseImportProfile(body.profile)
  if (profile === undefined)
    return { error: 'That backup has a class setup Studydeck could not read.' }

  return {
    backup: { profile, subjects, entries, tasks, notes, sources, library, days, syllabus },
  }
}

/**
 * The app runs on the student's own machine: one workspace, no accounts. Every
 * write still has to come from this origin so a stray web page in the same
 * browser cannot change the timetable behind their back.
 */
export function createApp(db: SqlDatabase, env: Env = {}) {
  const app = new Hono<AppContext>()
  app.get('/api/health', (c) => c.json({ ok: true }))
  /** Every notebook on this computer, oldest first. */
  async function notebooks(): Promise<Notebook[]> {
    const rows = await db
      .prepare(
        'SELECT id, name, created_at FROM notebooks WHERE owner_sub = ? ORDER BY created_at ASC',
      )
      .bind(BASE_OWNER)
      .all<NotebookRow>()
    return rows.results.map(mapNotebook)
  }

  /** The notebook the request asked for, or the first one that exists. */
  async function resolveNotebook(
    requested: string | null | undefined,
  ): Promise<Notebook> {
    const all = await notebooks()
    const match = requested ? all.find((item) => item.id === requested) : undefined
    return match ?? all[0]!
  }

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    if (WRITE_METHODS.has(c.req.method) && !sameOrigin(c.req.raw))
      return c.json({ error: 'Cross-origin request refused.' }, 403)
    await ensureSchema(db)
    const notebook = await resolveNotebook(c.req.header('x-notebook'))
    c.set('notebook', notebook)
    c.set('owner', scopedOwner(notebook.id))
    await next()
  })
  const smallBody = bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: 'Request is too large.' }, 413),
  })
  // A backup and a real document are bigger than any typed request, so only
  // their routes may be.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === IMPORT_PATH || c.req.path === EXTRACT_PATH) return next()
    return smallBody(c, next)
  })
  app.use(
    IMPORT_PATH,
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES,
      onError: (c) => c.json({ error: 'That backup is too large to import.' }, 413),
    }),
  )
  app.use(
    EXTRACT_PATH,
    bodyLimit({
      maxSize: MAX_EXTRACT_BYTES,
      onError: (c) =>
        c.json({ error: 'That file is too large to read here.' }, 413),
    }),
  )

  /** One payload shape for both the workspace load and a completed setup. */
  async function workspace(
    db: SqlDatabase,
    env: Env,
    owner: string,
    notebook: Notebook,
  ) {
    const [
      subjects,
      entries,
      tasks,
      notes,
      sources,
      library,
      syllabus,
      profileRow,
    ] = await Promise.all([
      db
        .prepare(
          'SELECT id, name, color, teacher, exam_date, created_at FROM subjects WHERE owner_sub = ? ORDER BY created_at ASC',
        )
        .bind(owner)
        .all<SubjectRow>(),
      db
        .prepare(
          `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? ORDER BY day ASC, start_min ASC`,
        )
        .bind(owner)
        .all<EntryRow>(),
      db
        .prepare(
          `SELECT ${taskColumns} FROM tasks WHERE owner_sub = ? ORDER BY done ASC, due_date ASC, created_at DESC LIMIT 300`,
        )
        .bind(owner)
        .all<TaskRow>(),
      db
        .prepare(
          `SELECT ${noteColumns} FROM study_notes WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 200`,
        )
        .bind(owner)
        .all<NoteRow>(),
      db
        .prepare(
          `SELECT ${sourceColumns} FROM sources WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 300`,
        )
        .bind(owner)
        .all<SourceRow>(),
      db
        .prepare(
          `SELECT ${messageColumns} FROM library_messages WHERE owner_sub = ? ORDER BY created_at ASC LIMIT 400`,
        )
        .bind(owner)
        .all<LibraryMessageRow>(),
      db
        .prepare(
          'SELECT subject_id, chapter FROM syllabus_progress WHERE owner_sub = ? ORDER BY done_at ASC',
        )
        .bind(owner)
        .all<{ subject_id: string; chapter: string }>(),
      db
        .prepare(
          'SELECT class_level, school_days, school_start, school_end, period_length, study_hours, setup_at FROM profiles WHERE owner_sub = ?',
        )
        .bind(BASE_OWNER)
        .first<ProfileRow>(),
    ])
    const { provider } = await effectiveProvider(db, env, BASE_OWNER)
    return {
      notebooks: await notebooks(),
      notebookId: notebook.id,
      subjects: subjects.results.map(mapSubject),
      entries: entries.results.map(mapEntry),
      tasks: tasks.results.map(mapTask),
      notes: notes.results.map(mapNote),
      sources: sources.results.map(mapSource),
      library: library.results.map(mapLibraryMessage),
      syllabus: syllabus.results.map((row) => ({
        subjectId: row.subject_id,
        chapter: row.chapter,
      })),
      profile: profileRow ? mapProfile(profileRow) : null,
      ai: {
        enabled: Boolean(provider),
        remaining: Math.max(0, AI_DAILY_LIMIT - (await usedAi(db, BASE_OWNER))),
        limit: AI_DAILY_LIMIT,
        provider: provider?.label ?? null,
        model: provider?.model ?? null,
      },
    }
  }

  app.get('/api/data', async (c) =>
    c.json(await workspace(db, env, c.get('owner'), c.get('notebook'))),
  )

  /** Every notebook on this computer, with the one being looked at. */
  app.get('/api/notebooks', async (c) =>
    c.json({ notebooks: await notebooks(), current: c.get('notebook') }),
  )

  app.post('/api/notebooks', async (c) => {
    const body = await readBody(c.req.raw)
    const name = clean(body?.name, 60)
    if (!name) return c.json({ error: 'Give the notebook a name.' }, 400)
    const all = await notebooks()
    if (all.length >= 20)
      return c.json({ error: 'That is as many notebooks as Studydeck holds.' }, 400)
    const notebook = { id: crypto.randomUUID(), name, createdAt: Date.now() }
    await db
      .prepare(
        'INSERT INTO notebooks (id, owner_sub, name, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(notebook.id, BASE_OWNER, notebook.name, notebook.createdAt)
      .run()
    return c.json({ notebook, notebooks: await notebooks() })
  })

  app.patch('/api/notebooks/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const id = identifier(c.req.param('id'))
    const name = clean(body?.name, 60)
    if (!id || !name)
      return c.json({ error: 'Give the notebook a name.' }, 400)
    const row = await db
      .prepare(
        'UPDATE notebooks SET name = ? WHERE id = ? AND owner_sub = ? RETURNING id, name, created_at',
      )
      .bind(name, id, BASE_OWNER)
      .first<NotebookRow>()
    if (!row) return c.json({ error: 'Notebook not found.' }, 404)
    return c.json({ notebook: mapNotebook(row), notebooks: await notebooks() })
  })

  /** Removing a notebook removes its own rows and nothing else. */
  app.delete('/api/notebooks/:id', async (c) => {
    const id = identifier(c.req.param('id'))
    const all = await notebooks()
    if (!id || !all.some((item) => item.id === id))
      return c.json({ error: 'Notebook not found.' }, 404)
    if (all.length <= 1)
      return c.json({ error: 'Keep at least one notebook.' }, 400)
    const owner = scopedOwner(id)
    await db.batch([
      ...NOTEBOOK_TABLES.map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE owner_sub = ?`).bind(owner),
      ),
      db
        .prepare('DELETE FROM notebooks WHERE id = ? AND owner_sub = ?')
        .bind(id, BASE_OWNER),
    ])
    return c.json({ notebooks: await notebooks() })
  })

  /** Every notebook the student owns, in one file they can keep. */
  app.get('/api/export', async (c) => {
    const profile = await readProfile(db, BASE_OWNER)
    const books = await notebooks()
    const today = new Date().toISOString().slice(0, 10)
    const parts = []
    for (const notebook of books) {
      const owner = scopedOwner(notebook.id)
      const data = await workspace(db, env, owner, notebook)
      const days = await db
        .prepare(
          `SELECT ${dayLogColumns} FROM day_logs WHERE owner_sub = ? ORDER BY date ASC`,
        )
        .bind(owner)
        .all<DayLogRow>()
      const messages = await db
        .prepare(
          `SELECT ${messageColumns} FROM library_messages WHERE owner_sub = ? ORDER BY created_at ASC`,
        )
        .bind(owner)
        .all<LibraryMessageRow>()
      parts.push({
        notebook: {
          id: notebook.id,
          name: notebook.name,
          createdAt: notebook.createdAt,
        },
        subjects: data.subjects,
        entries: data.entries,
        tasks: data.tasks,
        notes: data.notes,
        days: days.results.map(mapDayLog),
        syllabus: data.syllabus,
        sources: data.sources,
        library: messages.results.map(mapLibraryMessage),
      })
    }
    return c.body(
      JSON.stringify(
        {
          app: 'Studydeck',
          version: 2,
          exportedAt: new Date().toISOString(),
          profile,
          notebooks: parts,
        },
        null,
        2,
      ),
      200,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="studydeck-${today}.json"`,
      },
    )
  })

  /**
   * Loads a backup back in, additively. A row whose id is already here, a day
   * that was already checked in and a class setup that was already saved are
   * kept; everything else is inserted in one batch, so a bad file cannot leave
   * half a workspace behind.
   */
  /** What one notebook's part of a backup would add, and what it would keep. */
  async function planMerge(backup: Backup, owner: string) {
    const [
      subjectRows,
      entryRows,
      taskRows,
      noteRows,
      sourceRows,
      messageRows,
      dayRows,
      tickRows,
    ] = await Promise.all([
      db
        .prepare('SELECT id, name FROM subjects WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string; name: string }>(),
      db
        .prepare('SELECT id FROM entries WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string }>(),
      db
        .prepare('SELECT id FROM tasks WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string }>(),
      db
        .prepare('SELECT id FROM study_notes WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string }>(),
      db
        .prepare('SELECT id FROM sources WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string }>(),
      db
        .prepare('SELECT id FROM library_messages WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string }>(),
      db
        .prepare('SELECT date FROM day_logs WHERE owner_sub = ?')
        .bind(owner)
        .all<{ date: string }>(),
      db
        .prepare('SELECT subject_id, chapter FROM syllabus_progress WHERE owner_sub = ?')
        .bind(owner)
        .all<{ subject_id: string; chapter: string }>(),
    ])

    const existingSubjectIds = new Set(subjectRows.results.map((row) => row.id))
    const byName = new Map(
      subjectRows.results.map((row) => [row.name.toLowerCase(), row.id]),
    )
    const entryIds = new Set(entryRows.results.map((row) => row.id))
    const taskIds = new Set(taskRows.results.map((row) => row.id))
    const noteIds = new Set(noteRows.results.map((row) => row.id))
    const sourceIds = new Set(sourceRows.results.map((row) => row.id))
    const messageIds = new Set(messageRows.results.map((row) => row.id))
    const dayDates = new Set(dayRows.results.map((row) => row.date))
    const tickKeys = new Set(
      tickRows.results.map((row) => `${row.subject_id}::${row.chapter}`),
    )

    const added = emptyCounts()
    const skipped = emptyCounts()
    const statements: SqlStatement[] = []
    const subjectMap = new Map<string, string>()

    for (const subject of backup.subjects) {
      const known = existingSubjectIds.has(subject.id)
      const sameName = byName.get(subject.input.name.toLowerCase())
      const target = known ? subject.id : sameName
      if (target) {
        subjectMap.set(subject.id, target)
        skipped.subjects += 1
        continue
      }
      subjectMap.set(subject.id, subject.id)
      byName.set(subject.input.name.toLowerCase(), subject.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO subjects (id, owner_sub, name, color, teacher, exam_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            subject.id,
            owner,
            subject.input.name,
            subject.input.color,
            subject.input.teacher,
            subject.input.examDate,
            subject.createdAt,
          ),
      )
      added.subjects += 1
    }

    /** A reference to material that is not here becomes "no subject". */
    const resolveSubject = (id: string | null): string | null => {
      if (!id) return null
      const mapped = subjectMap.get(id)
      if (mapped) return mapped
      return existingSubjectIds.has(id) ? id : null
    }

    for (const block of backup.entries) {
      if (entryIds.has(block.id)) {
        skipped.entries += 1
        continue
      }
      entryIds.add(block.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO entries (id, owner_sub, subject_id, title, kind, day, start_min, end_min, room, plan, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            block.id,
            owner,
            resolveSubject(block.input.subjectId),
            block.input.title,
            block.input.kind,
            block.input.day,
            block.input.startMin,
            block.input.endMin,
            block.input.room,
            block.input.plan,
            block.input.date,
          ),
      )
      added.entries += 1
    }

    for (const task of backup.tasks) {
      if (taskIds.has(task.id)) {
        skipped.tasks += 1
        continue
      }
      taskIds.add(task.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO tasks (id, owner_sub, subject_id, title, due_date, priority, done, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            task.id,
            owner,
            resolveSubject(task.input.subjectId),
            task.input.title,
            task.input.dueDate,
            task.input.priority,
            task.input.done ? 1 : 0,
            task.input.details,
            task.createdAt,
          ),
      )
      added.tasks += 1
    }

    for (const note of backup.notes) {
      if (noteIds.has(note.id)) {
        skipped.notes += 1
        continue
      }
      noteIds.add(note.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            note.id,
            owner,
            resolveSubject(note.input.subjectId),
            note.input.title,
            note.input.body,
            note.createdAt,
            note.updatedAt,
          ),
      )
      added.notes += 1
    }

    for (const source of backup.sources) {
      if (sourceIds.has(source.id)) {
        skipped.sources += 1
        continue
      }
      sourceIds.add(source.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO sources (id, owner_sub, subject_id, title, origin, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            source.id,
            owner,
            resolveSubject(source.input.subjectId),
            source.input.title,
            source.input.origin,
            source.input.body,
            source.createdAt,
            source.updatedAt,
          ),
      )
      added.sources += 1
    }

    for (const message of backup.library) {
      if (messageIds.has(message.id)) {
        skipped.library += 1
        continue
      }
      messageIds.add(message.id)
      statements.push(
        db
          .prepare(
            'INSERT INTO library_messages (id, owner_sub, subject_id, role, body, citations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            message.id,
            owner,
            resolveSubject(message.subjectId),
            message.role,
            message.body,
            JSON.stringify(message.citations),
            message.createdAt,
          ),
      )
      added.library += 1
    }

    for (const day of backup.days) {
      if (dayDates.has(day.log.date)) {
        skipped.days += 1
        continue
      }
      dayDates.add(day.log.date)
      statements.push(
        db
          .prepare(
            'INSERT INTO day_logs (owner_sub, date, school, coaching, homework, free_from, free_until, brief, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            owner,
            day.log.date,
            JSON.stringify(day.log.school),
            JSON.stringify(day.log.coaching),
            JSON.stringify(day.log.homework),
            day.log.freeFrom,
            day.log.freeUntil,
            day.log.brief,
            day.updatedAt,
          ),
      )
      added.days += 1
    }

    for (const tick of backup.syllabus) {
      const subjectId = resolveSubject(tick.subjectId)
      if (!subjectId || tickKeys.has(`${subjectId}::${tick.chapter}`)) {
        skipped.syllabus += 1
        continue
      }
      tickKeys.add(`${subjectId}::${tick.chapter}`)
      statements.push(
        db
          .prepare(
            'INSERT INTO syllabus_progress (owner_sub, subject_id, chapter, done_at) VALUES (?, ?, ?, ?)',
          )
          .bind(owner, subjectId, tick.chapter, tick.doneAt),
      )
      added.syllabus += 1
    }

    return { added, skipped, statements }
  }

  /**
   * Loads a backup back in, additively. A version 1 file goes into the notebook
   * being looked at; a version 2 file brings its own notebooks, matched by id
   * and then by name so importing twice does not clone them.
   */
  app.post(IMPORT_PATH, async (c) => {
    const body = await readBody(c.req.raw)
    if (!body)
      return c.json(
        { error: 'That file could not be read. Choose a Studydeck backup (.json).' },
        400,
      )
    const parsed = parseBackup(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const all = await notebooks()
    const plan: { notebook: Notebook; backup: Backup; create: boolean }[] = []
    for (const part of parsed.parts) {
      if (!part.notebook) {
        plan.push({
          notebook: c.get('notebook'),
          backup: part.backup,
          create: false,
        })
        continue
      }
      const meta = part.notebook
      const match =
        all.find((item) => item.id === meta.id) ??
        all.find((item) => item.name.toLowerCase() === meta.name.toLowerCase())
      plan.push({
        notebook: match ?? meta,
        backup: part.backup,
        create: !match,
      })
    }

    const creates = plan.filter((entry) => entry.create)
    if (all.length + creates.length > 20)
      return c.json(
        { error: 'That backup has more notebooks than Studydeck holds.' },
        400,
      )

    const added = emptyCounts()
    const skipped = emptyCounts()
    const statements: SqlStatement[] = []
    const createdIds = new Set<string>()
    for (const entry of plan) {
      if (entry.create && !createdIds.has(entry.notebook.id)) {
        createdIds.add(entry.notebook.id)
        statements.push(
          db
            .prepare(
              'INSERT INTO notebooks (id, owner_sub, name, created_at) VALUES (?, ?, ?, ?)',
            )
            .bind(
              entry.notebook.id,
              BASE_OWNER,
              entry.notebook.name,
              entry.notebook.createdAt,
            ),
        )
      }
      const merged = await planMerge(
        entry.backup,
        scopedOwner(entry.notebook.id),
      )
      statements.push(...merged.statements)
      for (const key of Object.keys(added) as (keyof ImportCounts)[]) {
        added[key] += merged.added[key]
        skipped[key] += merged.skipped[key]
      }
    }

    // The class setup drives the whole timetable, so an existing one wins.
    if (parsed.profile && !(await readProfile(db, BASE_OWNER))) {
      statements.push(
        db
          .prepare(
            'INSERT INTO profiles (owner_sub, class_level, school_days, school_start, school_end, period_length, study_hours, setup_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            BASE_OWNER,
            parsed.profile.classLevel,
            parsed.profile.schoolDays.join(','),
            parsed.profile.schoolStart,
            parsed.profile.schoolEnd,
            parsed.profile.periodLength,
            parsed.profile.studyHours,
            parsed.profile.setupAt,
          ),
      )
      added.profile += 1
    } else if (parsed.profile) {
      skipped.profile += 1
    }

    if (statements.length > MAX_IMPORT_STATEMENTS)
      return c.json({ error: 'That backup is too large to import at once.' }, 400)
    if (statements.length) await db.batch(statements)
    return c.json({
      added,
      skipped,
      notebooks: await notebooks(),
      workspace: await workspace(db, env, c.get('owner'), c.get('notebook')),
    })
  })

  /** The weekly timetable and revision plan, ready for any calendar app. */
  app.get('/api/timetable.ics', async (c) => {
    const rows = await db
      .prepare(
        `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? ORDER BY day ASC, start_min ASC`,
      )
      .bind(c.get('owner'))
      .all<EntryRow>()
    return c.body(timetableFile(rows.results.map(mapEntry)), 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${calendarFileName()}"`,
    })
  })

  /**
   * Deletes every row the student owns. There is no undo, so the browser asks
   * first and offers the export above as the way to keep a copy.
   */
  app.delete('/api/workspace', async (c) => {
    const owner = c.get('owner')
    // Only this notebook is emptied: other books, the class setup and any saved
    // AI key belong to the whole app.
    await db.batch(
      NOTEBOOK_TABLES.map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE owner_sub = ?`).bind(owner),
      ),
    )
    return c.json(await workspace(db, env, owner, c.get('notebook')))
  })

  /**
   * The class-setup wizard: stores the class and daily schedule, creates or
   * updates the subjects by name, then replaces the generated timetables.
   * Notes and tasks are never touched, so a re-run keeps the student's work.
   */
  app.post('/api/setup', async (c) => {
    const owner = c.get('owner')
    const body = await readBody(c.req.raw)
    const invalid = () =>
      c.json(
        { error: 'That setup could not be saved. Check your class, school hours and subjects.' },
        400,
      )
    if (!body) return invalid()

    const classLevel = whole(body.classLevel, 6, 12)
    const schoolStart = whole(body.schoolStart, 0, 1439)
    const schoolEnd = whole(body.schoolEnd, 1, 1440)
    const periodLength = whole(body.periodLength, 20, 120)
    const studyHours =
      typeof body.studyHours === 'number' &&
      body.studyHours >= 1 &&
      body.studyHours <= 10
        ? body.studyHours
        : null
    const schoolDays = Array.isArray(body.schoolDays)
      ? body.schoolDays.filter(
          (value): value is number =>
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 6,
        )
      : null
    const subjectList = Array.isArray(body.subjects) ? body.subjects : null
    const regularList = Array.isArray(body.regular) ? body.regular : []
    const revisionList = Array.isArray(body.revision) ? body.revision : []

    if (
      classLevel === null ||
      schoolStart === null ||
      schoolEnd === null ||
      schoolEnd <= schoolStart ||
      periodLength === null ||
      studyHours === null ||
      !schoolDays ||
      schoolDays.length === 0 ||
      !subjectList ||
      subjectList.length === 0 ||
      subjectList.length > 20 ||
      regularList.length > 400 ||
      revisionList.length > 400
    )
      return invalid()

    const parsedSubjects: { key: string; input: SubjectInput }[] = []
    for (const item of subjectList) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid()
      const record = item as Record<string, unknown>
      const key = identifier(record.key)
      const input = parseSubject(record)
      if (!key || !input) return invalid()
      parsedSubjects.push({ key, input })
    }

    const regularInputs: EntryInput[] = []
    for (const item of regularList) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid()
      const parsed = parseEntry(item as Record<string, unknown>)
      if (!parsed || parsed.plan !== 'regular') return invalid()
      regularInputs.push(parsed)
    }
    const revisionInputs: EntryInput[] = []
    for (const item of revisionList) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid()
      const parsed = parseEntry(item as Record<string, unknown>)
      if (!parsed || parsed.plan !== 'intensive') return invalid()
      revisionInputs.push(parsed)
    }

    const existing = await db
      .prepare('SELECT id, name FROM subjects WHERE owner_sub = ?')
      .bind(owner)
      .all<{ id: string; name: string }>()
    const byName = new Map(
      existing.results.map((row) => [row.name.toLowerCase(), row.id]),
    )
    const now = Date.now()
    const keyToId = new Map<string, string>()
    const subjectStatements: SqlStatement[] = []
    for (const subject of parsedSubjects) {
      const match = byName.get(subject.input.name.toLowerCase())
      if (match) {
        keyToId.set(subject.key, match)
        subjectStatements.push(
          db
            .prepare(
              'UPDATE subjects SET color = ?, teacher = ?, exam_date = ? WHERE id = ? AND owner_sub = ?',
            )
            .bind(
              subject.input.color,
              subject.input.teacher,
              subject.input.examDate,
              match,
              owner,
            ),
        )
      } else {
        const id = crypto.randomUUID()
        keyToId.set(subject.key, id)
        subjectStatements.push(
          db
            .prepare(
              'INSERT INTO subjects (id, owner_sub, name, color, teacher, exam_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(
              id,
              owner,
              subject.input.name,
              subject.input.color,
              subject.input.teacher,
              subject.input.examDate,
              now,
            ),
        )
      }
    }

    const resolve = (key: string | null) => (key ? keyToId.get(key) ?? null : null)

    const entryStatements = [
      ...regularInputs.map((entry) =>
        insertEntry(db, owner, entry, 'regular', resolve(entry.subjectId)),
      ),
      ...revisionInputs.map((entry) =>
        insertEntry(db, owner, entry, 'intensive', resolve(entry.subjectId)),
      ),
    ]

    const profileStatement = db
      .prepare(
        `INSERT INTO profiles (owner_sub, class_level, school_days, school_start, school_end, period_length, study_hours, setup_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_sub) DO UPDATE SET class_level = excluded.class_level, school_days = excluded.school_days,
           school_start = excluded.school_start, school_end = excluded.school_end,
           period_length = excluded.period_length, study_hours = excluded.study_hours, setup_at = excluded.setup_at`,
      )
      .bind(
        // The class and school week are the student's, not the notebook's.
        BASE_OWNER,
        classLevel,
        `${[...new Set(schoolDays)].sort((a, b) => a - b).join(',')}`,
        schoolStart,
        schoolEnd,
        periodLength,
        studyHours,
        now,
      )

    const statements = [
      db.prepare('DELETE FROM entries WHERE owner_sub = ?').bind(owner),
      profileStatement,
      ...subjectStatements,
      ...entryStatements,
    ]
    for (let index = 0; index < statements.length; index += 40) {
      await db.batch(statements.slice(index, index + 40))
    }

    return c.json(await workspace(db, env, owner, c.get('notebook')))
  })

  app.post('/api/subjects', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseSubject(body) : null
    if (!input)
      return c.json({ error: 'Give the subject a name of 40 characters or fewer.' }, 400)
    const owner = c.get('owner')
    const count = await db
      .prepare('SELECT COUNT(*) AS total FROM subjects WHERE owner_sub = ?')
      .bind(owner)
      .first<{ total: number }>()
    if ((count?.total ?? 0) >= 30)
      return c.json({ error: 'You can track up to 30 subjects.' }, 400)
    const row = await db
      .prepare(
        'INSERT INTO subjects (id, owner_sub, name, color, teacher, exam_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, name, color, teacher, exam_date, created_at',
      )
      .bind(
        crypto.randomUUID(),
        owner,
        input.name,
        input.color,
        input.teacher,
        input.examDate,
        Date.now(),
      )
      .first<SubjectRow>()
    return c.json({ subject: mapSubject(row!) }, 201)
  })

  app.patch('/api/subjects/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseSubject(body) : null
    if (!input) return c.json({ error: 'That subject could not be saved.' }, 400)
    const row = await db
      .prepare(
        'UPDATE subjects SET name = ?, color = ?, teacher = ?, exam_date = ? WHERE id = ? AND owner_sub = ? RETURNING id, name, color, teacher, exam_date, created_at',
      )
      .bind(
        input.name,
        input.color,
        input.teacher,
        input.examDate,
        c.req.param('id'),
        c.get('owner'),
      )
      .first<SubjectRow>()
    return row
      ? c.json({ subject: mapSubject(row) })
      : c.json({ error: 'Subject not found.' }, 404)
  })

  app.delete('/api/subjects/:id', async (c) => {
    const owner = c.get('owner')
    const id = c.req.param('id')
    const removed = await db
      .prepare('DELETE FROM subjects WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(id, owner)
      .first()
    if (!removed) return c.json({ error: 'Subject not found.' }, 404)
    await db.batch([
      db
        .prepare('UPDATE entries SET subject_id = NULL WHERE subject_id = ? AND owner_sub = ?')
        .bind(id, owner),
      db
        .prepare('UPDATE tasks SET subject_id = NULL WHERE subject_id = ? AND owner_sub = ?')
        .bind(id, owner),
      db
        .prepare(
          'UPDATE study_notes SET subject_id = NULL WHERE subject_id = ? AND owner_sub = ?',
        )
        .bind(id, owner),
      db
        .prepare(
          'UPDATE sources SET subject_id = NULL WHERE subject_id = ? AND owner_sub = ?',
        )
        .bind(id, owner),
      db
        .prepare(
          'UPDATE library_messages SET subject_id = NULL WHERE subject_id = ? AND owner_sub = ?',
        )
        .bind(id, owner),
      db
        .prepare(
          'DELETE FROM syllabus_progress WHERE subject_id = ? AND owner_sub = ?',
        )
        .bind(id, owner),
    ])
    return c.json({ ok: true })
  })

  /** Ticks or clears one NCERT chapter for a subject the student owns. */
  app.post('/api/syllabus', async (c) => {
    const body = await readBody(c.req.raw)
    const subjectId = body ? identifier(body.subjectId) : null
    const chapter = body ? clean(body.chapter, 120) : ''
    if (!subjectId || !chapter)
      return c.json({ error: 'Pick a subject and chapter to track.' }, 400)
    const owner = c.get('owner')
    const owned = await db
      .prepare('SELECT id FROM subjects WHERE id = ? AND owner_sub = ?')
      .bind(subjectId, owner)
      .first()
    if (!owned) return c.json({ error: 'Subject not found.' }, 404)
    const done = body!.done === true
    if (done) {
      await db
        .prepare(
          'INSERT INTO syllabus_progress (owner_sub, subject_id, chapter, done_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_sub, subject_id, chapter) DO UPDATE SET done_at = excluded.done_at',
        )
        .bind(owner, subjectId, chapter, Date.now())
        .run()
    } else {
      await db
        .prepare(
          'DELETE FROM syllabus_progress WHERE owner_sub = ? AND subject_id = ? AND chapter = ?',
        )
        .bind(owner, subjectId, chapter)
        .run()
    }
    return c.json({ subjectId, chapter, done })
  })

  app.post('/api/entries', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseEntry(body) : null
    if (!input)
      return c.json(
        { error: 'Check the day, start and finish times for that block.' },
        400,
      )
    const row = await db
      .prepare(
        `INSERT INTO entries (id, owner_sub, subject_id, title, kind, day, start_min, end_min, room, plan, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${entryColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        c.get('owner'),
        input.subjectId,
        input.title,
        input.kind,
        input.day,
        input.startMin,
        input.endMin,
        input.room,
        input.plan,
        input.date,
      )
      .first<EntryRow>()
    return c.json({ entry: mapEntry(row!) }, 201)
  })

  app.patch('/api/entries/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseEntry(body) : null
    if (!input)
      return c.json(
        { error: 'Check the day, start and finish times for that block.' },
        400,
      )
    const row = await db
      .prepare(
        `UPDATE entries SET subject_id = ?, title = ?, kind = ?, day = ?, start_min = ?, end_min = ?, room = ?, plan = ?, date = ? WHERE id = ? AND owner_sub = ? RETURNING ${entryColumns}`,
      )
      .bind(
        input.subjectId,
        input.title,
        input.kind,
        input.day,
        input.startMin,
        input.endMin,
        input.room,
        input.plan,
        input.date,
        c.req.param('id'),
        c.get('owner'),
      )
      .first<EntryRow>()
    return row
      ? c.json({ entry: mapEntry(row) })
      : c.json({ error: 'Block not found.' }, 404)
  })

  app.delete('/api/entries/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM entries WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), c.get('owner'))
      .first()
    return removed
      ? c.json({ ok: true })
      : c.json({ error: 'Block not found.' }, 404)
  })

  /** Replaces the whole generated revision plan in one step. */
  app.post('/api/entries/plan', async (c) => {
    const body = await readBody(c.req.raw)
    const list = body && Array.isArray(body.entries) ? body.entries : null
    if (!list || list.length > 400)
      return c.json({ error: 'That revision plan could not be saved.' }, 400)
    const inputs: EntryInput[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return c.json({ error: 'That revision plan could not be saved.' }, 400)
      const parsed = parseEntry(item as Record<string, unknown>)
      if (!parsed || parsed.plan !== 'intensive')
        return c.json({ error: 'That revision plan could not be saved.' }, 400)
      inputs.push(parsed)
    }
    const owner = c.get('owner')
    await db
      .prepare('DELETE FROM entries WHERE plan = ? AND owner_sub = ?')
      .bind('intensive', owner)
      .run()
    for (let index = 0; index < inputs.length; index += 50) {
      await db.batch(
        inputs
          .slice(index, index + 50)
          .map((input) =>
            insertEntry(db, owner, input, 'intensive', input.subjectId),
          ),
      )
    }
    const rows = await db
      .prepare(
        `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? AND plan = 'intensive' ORDER BY date ASC, start_min ASC`,
      )
      .bind(owner)
      .all<EntryRow>()
    return c.json({ entries: rows.results.map(mapEntry) })
  })

  app.post('/api/tasks', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseTask(body) : null
    if (!input)
      return c.json({ error: 'A task needs a title of 120 characters or fewer.' }, 400)
    const row = await db
      .prepare(
        `INSERT INTO tasks (id, owner_sub, subject_id, title, due_date, priority, done, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${taskColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        c.get('owner'),
        input.subjectId,
        input.title,
        input.dueDate,
        input.priority,
        input.done ? 1 : 0,
        input.details,
        Date.now(),
      )
      .first<TaskRow>()
    return c.json({ task: mapTask(row!) }, 201)
  })

  app.patch('/api/tasks/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseTask(body) : null
    if (!input) return c.json({ error: 'That task could not be saved.' }, 400)
    const row = await db
      .prepare(
        `UPDATE tasks SET subject_id = ?, title = ?, due_date = ?, priority = ?, done = ?, details = ? WHERE id = ? AND owner_sub = ? RETURNING ${taskColumns}`,
      )
      .bind(
        input.subjectId,
        input.title,
        input.dueDate,
        input.priority,
        input.done ? 1 : 0,
        input.details,
        c.req.param('id'),
        c.get('owner'),
      )
      .first<TaskRow>()
    return row
      ? c.json({ task: mapTask(row) })
      : c.json({ error: 'Task not found.' }, 404)
  })

  app.delete('/api/tasks/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM tasks WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), c.get('owner'))
      .first()
    return removed
      ? c.json({ ok: true })
      : c.json({ error: 'Task not found.' }, 404)
  })

  app.post('/api/notes', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseNote(body) : null
    if (!input)
      return c.json(
        { error: 'Write a note of up to 8,000 characters before saving.' },
        400,
      )
    const now = Date.now()
    const row = await db
      .prepare(
        `INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${noteColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        c.get('owner'),
        input.subjectId,
        input.title,
        input.body,
        now,
        now,
      )
      .first<NoteRow>()
    return c.json({ note: mapNote(row!) }, 201)
  })

  app.patch('/api/notes/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseNote(body) : null
    if (!input)
      return c.json(
        { error: 'Write a note of up to 8,000 characters before saving.' },
        400,
      )
    const row = await db
      .prepare(
        `UPDATE study_notes SET subject_id = ?, title = ?, body = ?, updated_at = ? WHERE id = ? AND owner_sub = ? RETURNING ${noteColumns}`,
      )
      .bind(
        input.subjectId,
        input.title,
        input.body,
        Date.now(),
        c.req.param('id'),
        c.get('owner'),
      )
      .first<NoteRow>()
    return row
      ? c.json({ note: mapNote(row) })
      : c.json({ error: 'Note not found.' }, 404)
  })

  app.delete('/api/notes/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM study_notes WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), c.get('owner'))
      .first()
    return removed
      ? c.json({ ok: true })
      : c.json({ error: 'Note not found.' }, 404)
  })

  /* The library: material, search, grounded questions and transformations. */

  /** Material for one subject, or the unsorted material when none is named. */
  async function librarySources(
    owner: string,
    subjectId: string | null,
  ): Promise<SourceRow[]> {
    const rows = await db
      .prepare(
        `SELECT ${sourceColumns} FROM sources WHERE owner_sub = ? AND subject_id IS ? ORDER BY updated_at DESC LIMIT 300`,
      )
      .bind(owner, subjectId)
      .all<SourceRow>()
    return rows.results
  }

  /** Cut every row into paragraphs once, for retrieval and search. */
  const chunksOf = (rows: SourceRow[]) =>
    rows.flatMap((row) =>
      chunkSource({ id: row.id, title: row.title, body: row.body }),
    )

  /**
   * Meaning vectors are worked out from the material, so they live in memory
   * and are rebuilt only when that material changes. Nothing extra is stored
   * in the data file or sent anywhere.
   */
  const meanings = new Map<string, { signature: string; index: SemanticIndex }>()
  async function meaningIndex(
    owner: string,
    subjectId: string | null,
    chunks: ReturnType<typeof chunksOf>,
  ): Promise<SemanticIndex> {
    const mark = await db
      .prepare(
        'SELECT COUNT(*) AS total, COALESCE(MAX(updated_at), 0) AS latest, COALESCE(SUM(LENGTH(body)), 0) AS size FROM sources WHERE owner_sub = ? AND subject_id IS ?',
      )
      .bind(owner, subjectId)
      .first<{ total: number; latest: number; size: number }>()
    const slot = `${owner}|${subjectId ?? 'all'}`
    const signature = `${mark?.total ?? 0}:${mark?.latest ?? 0}:${mark?.size ?? 0}`
    const cached = meanings.get(slot)
    if (cached?.signature === signature) return cached.index
    const index = buildSemanticIndex(chunks)
    meanings.set(slot, { signature, index })
    return index
  }

  app.post('/api/sources', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseSource(body) : null
    if (!input)
      return c.json(
        {
          error: `Add a title and up to ${MAX_SOURCE_CHARS.toLocaleString()} characters of material.`,
        },
        400,
      )
    if (input.subjectId) {
      const owned = await db
        .prepare('SELECT id FROM subjects WHERE id = ? AND owner_sub = ?')
        .bind(input.subjectId, c.get('owner'))
        .first()
      if (!owned) return c.json({ error: 'Subject not found.' }, 404)
    }
    const count = await db
      .prepare('SELECT COUNT(*) AS total FROM sources WHERE owner_sub = ?')
      .bind(c.get('owner'))
      .first<{ total: number }>()
    if ((count?.total ?? 0) >= 200)
      return c.json({ error: 'The library holds up to 200 pieces of material.' }, 400)
    const now = Date.now()
    const row = await db
      .prepare(
        `INSERT INTO sources (id, owner_sub, subject_id, title, origin, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${sourceColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        c.get('owner'),
        input.subjectId,
        input.title,
        input.origin,
        input.body,
        now,
        now,
      )
      .first<SourceRow>()
    return c.json({ source: mapSource(row!) }, 201)
  })

  app.patch('/api/sources/:id', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseSource(body) : null
    if (!input)
      return c.json(
        {
          error: `Add a title and up to ${MAX_SOURCE_CHARS.toLocaleString()} characters of material.`,
        },
        400,
      )
    const row = await db
      .prepare(
        `UPDATE sources SET subject_id = ?, title = ?, origin = ?, body = ?, updated_at = ? WHERE id = ? AND owner_sub = ? RETURNING ${sourceColumns}`,
      )
      .bind(
        input.subjectId,
        input.title,
        input.origin,
        input.body,
        Date.now(),
        c.req.param('id'),
        c.get('owner'),
      )
      .first<SourceRow>()
    return row
      ? c.json({ source: mapSource(row) })
      : c.json({ error: 'Material not found.' }, 404)
  })

  app.delete('/api/sources/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM sources WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), c.get('owner'))
      .first()
    return removed
      ? c.json({ ok: true })
      : c.json({ error: 'Material not found.' }, 404)
  })

  /**
   * Search the material by words and by meaning, one best paragraph per source.
   * A paragraph that shares no word with the query still comes back when the
   * material's own vocabulary puts it near what was asked.
   */
  app.get('/api/library/search', async (c) => {
    const query = clean(c.req.query('q'), 200)
    const rawSubject = c.req.query('subjectId')
    const subjectId = rawSubject ? identifier(rawSubject) : null
    if (rawSubject && !subjectId)
      return c.json({ error: 'Subject not found.' }, 404)
    if (!query) return c.json({ results: [] as LibrarySearchHit[] })
    const owner = c.get('owner')
    const rows = await librarySources(owner, subjectId)
    const chunks = chunksOf(rows)
    const index = await meaningIndex(owner, subjectId, chunks)
    return c.json({ results: search(chunks, query, 8, index) })
  })

  /** Ask a question of the material and keep the exchange in the notebook. */
  app.post('/api/library/ask', async (c) => {
    const body = await readBody(c.req.raw)
    const question = clean(body?.question, 500)
    const subjectId = optionalIdentifier(body?.subjectId)
    if (!question || subjectId === undefined)
      return c.json({ error: 'Ask a question of up to 500 characters.' }, 400)
    const owner = c.get('owner')
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const rows = await librarySources(owner, subjectId)
    if (!rows.length)
      return c.json(
        { error: 'Add some material first. Answers come from what you add.' },
        400,
      )
    const chunks = chunksOf(rows)
    const cited = retrieve(
      chunks,
      question,
      undefined,
      await meaningIndex(owner, subjectId, chunks),
    )
    const quota = await consumeAi(db, owner)
    if (!quota.ok)
      return c.json(
        { error: `You have used today’s ${AI_DAILY_LIMIT} AI actions. They reset tomorrow.` },
        429,
      )
    try {
      const answer = await answerFromMaterial(
        provider,
        question,
        cited,
        await syllabusContext(db, owner),
      )
      const now = Date.now()
      const student = {
        id: crypto.randomUUID(),
        subjectId,
        role: 'student' as const,
        body: question,
        citations: [],
        createdAt: now,
      }
      const reply = {
        id: crypto.randomUUID(),
        subjectId,
        role: 'assistant' as const,
        body: answer,
        citations: cited.map(({ index, sourceId, sourceTitle }) => ({
          index,
          sourceId,
          sourceTitle,
        })),
        createdAt: now + 1,
      }
      const insert = (message: typeof student | typeof reply) =>
        db
          .prepare(
            'INSERT INTO library_messages (id, owner_sub, subject_id, role, body, citations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            message.id,
            owner,
            message.subjectId,
            message.role,
            message.body,
            JSON.stringify(message.citations),
            message.createdAt,
          )
      await db.batch([
        insert(student),
        insert(reply),
        // A notebook keeps the recent conversation, not every question ever.
        db
          .prepare(
            `DELETE FROM library_messages WHERE owner_sub = ? AND subject_id IS ? AND id NOT IN (
               SELECT id FROM library_messages WHERE owner_sub = ? AND subject_id IS ? ORDER BY created_at DESC LIMIT 40
             )`,
          )
          .bind(owner, subjectId, owner, subjectId),
      ])
      return c.json({ student, reply, remaining: quota.remaining })
    } catch (error) {
      return c.json(
        { error: error instanceof AiError ? error.message : AI_FAILED },
        502,
      )
    }
  })

  /** Starts the conversation for a subject over. */
  app.delete('/api/library/messages', async (c) => {
    const rawSubject = c.req.query('subjectId')
    const subjectId = rawSubject ? identifier(rawSubject) : null
    if (rawSubject && !subjectId)
      return c.json({ error: 'Subject not found.' }, 404)
    await db
      .prepare('DELETE FROM library_messages WHERE owner_sub = ? AND subject_id IS ?')
      .bind(c.get('owner'), subjectId)
      .run()
    return c.json({ ok: true })
  })

  /**
   * A transformation: make revision notes or practice questions from one piece
   * of material and keep the result as a study note.
   */
  app.post('/api/library/transform', async (c) => {
    const body = await readBody(c.req.raw)
    const sourceId = body ? identifier(body.sourceId) : null
    const subjectId = body ? identifier(body.subjectId) : null
    const kind = TRANSFORMS.find((option) => option === body?.kind)
    if (!kind || Boolean(sourceId) === Boolean(subjectId))
      return c.json(
        {
          error: 'Pick a piece of material or a subject, and what to make from it.',
        },
        400,
      )
    const owner = c.get('owner')

    /** One item, or everything filed under one subject. */
    let heading: string
    let noteSubjectId: string | null
    let material: NoteSource[]
    if (sourceId) {
      const row = await db
        .prepare(
          `SELECT ${sourceColumns} FROM sources WHERE id = ? AND owner_sub = ?`,
        )
        .bind(sourceId, owner)
        .first<SourceRow>()
      if (!row) return c.json({ error: 'Material not found.' }, 404)
      heading = row.title
      noteSubjectId = row.subject_id
      material = [{ title: row.title, body: row.body }]
    } else {
      const subject = await db
        .prepare('SELECT id, name FROM subjects WHERE id = ? AND owner_sub = ?')
        .bind(subjectId, owner)
        .first<{ id: string; name: string }>()
      if (!subject) return c.json({ error: 'Subject not found.' }, 404)
      const rows = await db
        .prepare(
          `SELECT ${sourceColumns} FROM sources WHERE owner_sub = ? AND subject_id = ? ORDER BY updated_at DESC LIMIT 40`,
        )
        .bind(owner, subject.id)
        .all<SourceRow>()
      if (!rows.results.length)
        return c.json(
          { error: `Add some material to ${subject.name} first.` },
          400,
        )
      heading = subject.name
      noteSubjectId = subject.id
      material = rows.results.map((item) => ({
        title: item.title,
        body: item.body,
      }))
    }
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const quota = await consumeAi(db, owner)
    if (!quota.ok)
      return c.json(
        { error: `You have used today’s ${AI_DAILY_LIMIT} AI actions. They reset tomorrow.` },
        429,
      )
    try {
      const context = await syllabusContext(db, owner)
      const text =
        kind === 'summary'
          ? await summariseNotes(provider, material, context)
          : kind === 'questions'
            ? await practiceQuestions(provider, material, context)
            : kind === 'flashcards'
              ? await revisionCards(provider, material, context)
              : await revisionSlides(provider, material, context)
      const now = Date.now()
      const title = `${TRANSFORM_TITLES[kind]} · ${heading}`.slice(0, 120)
      const note = await db
        .prepare(
          `INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${noteColumns}`,
        )
        .bind(
          crypto.randomUUID(),
          owner,
          noteSubjectId,
          title,
          text,
          now,
          now,
        )
        .first<NoteRow>()
      return c.json({ note: mapNote(note!), remaining: quota.remaining })
    } catch (error) {
      return c.json(
        { error: error instanceof AiError ? error.message : AI_FAILED },
        502,
      )
    }
  })

  /**
   * Reads a PDF, Word document or text file the student chose, so a chapter does
   * not have to be copied out by hand. The text comes back for review; nothing
   * is saved until they press Add to library.
   */
  app.post(EXTRACT_PATH, async (c) => {
    const name = clean(c.req.query('name'), 160)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (!bytes.length) return c.json({ error: 'That file is empty.' }, 400)
    const kind = documentKind(name, c.req.header('content-type') ?? '')
    if (kind === 'doc')
      return c.json(
        {
          error:
            'That is an older Word file (.doc). Open it and save as .docx, then try again.',
        },
        400,
      )
    if (!kind)
      return c.json(
        { error: 'Choose a PDF, a .docx file or a plain text file.' },
        400,
      )

    let text: string
    try {
      text = await extractDocument(bytes, kind)
    } catch {
      return c.json(
        {
          error:
            'That file could not be read. It may be damaged or protected by a password.',
        },
        400,
      )
    }
    if (!text)
      return c.json(
        {
          error:
            'There is no text in that file. A scanned PDF holds only pictures, so paste the text or use a PDF that has a text layer.',
        },
        400,
      )
    return c.json({
      text: text.slice(0, MAX_SOURCE_CHARS),
      characters: text.length,
      truncated: text.length > MAX_SOURCE_CHARS,
    })
  })

  /* The day: what was taught, what was set, and tonight's plan. */

  async function dayLogFor(owner: string, date: string): Promise<DayLog | null> {
    const row = await db
      .prepare(
        `SELECT ${dayLogColumns} FROM day_logs WHERE owner_sub = ? AND date = ?`,
      )
      .bind(owner, date)
      .first<DayLogRow>()
    return row ? mapDayLog(row) : null
  }

  /** Overdue work, unread chapters and the next exam, for the AI brief. */
  async function dayBacklog(owner: string, date: string) {
    const [profile, subjects, ticks, overdue] = await Promise.all([
      readProfile(db, owner),
      db
        .prepare('SELECT id, name, exam_date FROM subjects WHERE owner_sub = ?')
        .bind(owner)
        .all<{ id: string; name: string; exam_date: string }>(),
      db
        .prepare('SELECT subject_id, chapter FROM syllabus_progress WHERE owner_sub = ?')
        .bind(owner)
        .all<{ subject_id: string; chapter: string }>(),
      db
        .prepare(
          'SELECT COUNT(*) AS total FROM tasks WHERE owner_sub = ? AND done = 0 AND due_date != ? AND due_date < ?',
        )
        .bind(owner, '', date)
        .first<{ total: number }>(),
    ])
    const done = new Set(
      ticks.results.map((row) => `${row.subject_id}::${row.chapter}`),
    )
    let chaptersLeft = 0
    for (const subject of subjects.results) {
      const chapters = profile
        ? unitsFor(profile.classLevel, subject.name)
        : []
      chaptersLeft += chapters.filter(
        (chapter) => !done.has(`${subject.id}::${chapter}`),
      ).length
    }
    const exams = subjects.results
      .map((subject) => subject.exam_date)
      .filter((exam) => exam && exam >= date)
      .sort()
    const nearestExamInDays = exams.length
      ? Math.round(
          (new Date(`${exams[0]}T00:00:00Z`).getTime() -
            new Date(`${date}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      : null
    return {
      backlog: {
        overdueTasks: overdue?.total ?? 0,
        chaptersLeft,
        nearestExamInDays,
      },
      context: await syllabusContext(db, owner),
    }
  }

  /** Today's real timetable plus whatever was saved for that day. */
  app.get('/api/day', async (c) => {
    const date = clean(c.req.query('date'), 10)
    if (!DATE_PATTERN.test(date))
      return c.json({ error: 'Pick a day to plan.' }, 400)
    const owner = c.get('owner')
    const [log, classes] = await Promise.all([
      dayLogFor(owner, date),
      db
        .prepare(
          `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? AND plan = 'regular' AND day = ? ORDER BY start_min ASC`,
        )
        .bind(owner, dayOfDate(date))
        .all<EntryRow>(),
    ])
    const mapped = classes.results
      .map(mapEntry)
      .filter((entry) => entry.kind !== 'break')
    return c.json({
      date,
      log,
      classes: mapped,
      coaching: mapped.find((entry) => entry.title === 'Coaching') ?? null,
    })
  })

  app.put('/api/day', async (c) => {
    const body = await readBody(c.req.raw)
    const parsed = body ? parseDayLog(body) : null
    if (!parsed)
      return c.json(
        {
          error:
            'That day could not be saved. Check the free times, the homework amounts and the coaching times.',
        },
        400,
      )
    const owner = c.get('owner')
    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO day_logs (owner_sub, date, school, coaching, homework, free_from, free_until, brief, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_sub, date) DO UPDATE SET school = excluded.school,
           coaching = excluded.coaching, homework = excluded.homework,
           free_from = excluded.free_from, free_until = excluded.free_until,
           brief = excluded.brief, updated_at = excluded.updated_at`,
      )
      .bind(
        owner,
        parsed.date,
        JSON.stringify(parsed.school),
        JSON.stringify(parsed.coaching),
        JSON.stringify(parsed.homework),
        parsed.freeFrom,
        parsed.freeUntil,
        parsed.brief,
        now,
      )
      .run()
    return c.json({ log: await dayLogFor(owner, parsed.date) })
  })

  /** Replaces only one day of the evening plan, leaving other days alone. */
  app.post('/api/entries/day', async (c) => {
    const body = await readBody(c.req.raw)
    const date = body ? clean(body.date, 10) : ''
    const list = body && Array.isArray(body.entries) ? body.entries : null
    if (!DATE_PATTERN.test(date) || !list || list.length > 200)
      return c.json({ error: 'That plan could not be saved.' }, 400)
    const inputs: EntryInput[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return c.json({ error: 'That plan could not be saved.' }, 400)
      const parsed = parseEntry(item as Record<string, unknown>)
      if (!parsed || parsed.plan !== 'intensive' || parsed.date !== date)
        return c.json({ error: 'That plan could not be saved.' }, 400)
      inputs.push(parsed)
    }
    const owner = c.get('owner')
    await db
      .prepare(
        `DELETE FROM entries WHERE owner_sub = ? AND plan = 'intensive' AND date = ?`,
      )
      .bind(owner, date)
      .run()
    for (let index = 0; index < inputs.length; index += 50) {
      await db.batch(
        inputs
          .slice(index, index + 50)
          .map((input) => insertEntry(db, owner, input, 'intensive', input.subjectId)),
      )
    }
    const rows = await db
      .prepare(
        `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? AND plan = 'intensive' AND date = ? ORDER BY start_min ASC`,
      )
      .bind(owner, date)
      .all<EntryRow>()
    return c.json({ entries: rows.results.map(mapEntry) })
  })

  /** An AI end-of-day brief over the saved check-in and tonight's plan. */
  app.post('/api/day/brief', async (c) => {
    const body = await readBody(c.req.raw)
    const date = body ? clean(body.date, 10) : ''
    if (!DATE_PATTERN.test(date))
      return c.json({ error: 'Pick a day to plan.' }, 400)
    const owner = c.get('owner')
    const log = await dayLogFor(owner, date)
    if (!log)
      return c.json(
        { error: 'Save your day first. The brief reads what you wrote.' },
        400,
      )
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const planned = await db
      .prepare(
        `SELECT title, start_min, end_min FROM entries WHERE owner_sub = ? AND plan = 'intensive' AND date = ? ORDER BY start_min ASC`,
      )
      .bind(owner, date)
      .all<{ title: string; start_min: number; end_min: number }>()
    const { backlog, context } = await dayBacklog(owner, date)
    const quota = await consumeAi(db, owner)
    if (!quota.ok)
      return c.json(
        { error: `You have used today’s ${AI_DAILY_LIMIT} AI actions. They reset tomorrow.` },
        429,
      )
    try {
      const brief = await dayBrief(
        provider,
        {
          school: log.school.map((item) => ({
            title: item.title,
            topic: item.topic,
          })),
          coaching: log.coaching
            ? {
                attending: log.coaching.attending,
                topic: log.coaching.topic,
              }
            : null,
          homework: log.homework
            .filter((item) => item.minutes > 0)
            .map((item) => ({ title: item.title, minutes: item.minutes })),
          planned: planned.results.map((row) => ({
            title: row.title,
            minutes: row.end_min - row.start_min,
          })),
          backlog,
        },
        context,
      )
      await db
        .prepare(
          'UPDATE day_logs SET brief = ?, updated_at = ? WHERE owner_sub = ? AND date = ?',
        )
        .bind(brief, Date.now(), owner, date)
        .run()
      return c.json({ brief, remaining: quota.remaining })
    } catch (error) {
      return c.json(
        { error: error instanceof AiError ? error.message : AI_FAILED },
        502,
      )
    }
  })

  async function sourceNotes(
    db: SqlDatabase,
    owner: string,
    body: Record<string, unknown> | null,
  ): Promise<NoteSource[]> {
    const ids = Array.isArray(body?.noteIds)
      ? body.noteIds.filter((id): id is string => identifier(id) !== null).slice(0, 12)
      : []
    const subjectId = identifier(body?.subjectId)
    let sql = 'SELECT title, body FROM study_notes WHERE owner_sub = ?'
    const params: string[] = [owner]
    if (ids.length) {
      sql += ` AND id IN (${ids.map(() => '?').join(', ')})`
      params.push(...ids)
    } else if (subjectId) {
      sql += ' AND subject_id = ?'
      params.push(subjectId)
    }
    sql += ' ORDER BY updated_at DESC LIMIT 8'
    const rows = await db
      .prepare(sql)
      .bind(...params)
      .all<{ title: string; body: string }>()
    return rows.results
  }

  /** The student's class and NCERT chapter outline, used to ground answers. */
  async function syllabusContext(db: SqlDatabase, owner: string): Promise<string> {
    const profile = await readProfile(db, owner)
    if (!profile) return ''
    const subjects = await db
      .prepare('SELECT name FROM subjects WHERE owner_sub = ?')
      .bind(owner)
      .all<{ name: string }>()
    const brief = syllabusBrief(
      profile.classLevel,
      subjects.results.map((row) => row.name),
    )
    return (
      `The student is in CBSE Class ${profile.classLevel} following the NCERT syllabus.\n` +
      (brief ? `Syllabus outline:\n${brief}\n` : '') +
      'Use NCERT chapter names and terminology. If a question falls outside this syllabus, say so.'
    )
  }

  /** Which service answers, and where its key comes from. Never the key. */
  app.get('/api/ai/settings', async (c) => {
    const owner = BASE_OWNER
    const stored = await readAiKey(db, owner)
    const { provider, source } = await effectiveProvider(db, env, owner)
    return c.json({
      source,
      provider: provider
        ? { id: provider.id, label: provider.label, model: provider.model }
        : null,
      saved: stored
        ? {
            provider: stored.provider,
            model: stored.model,
            baseUrl: stored.baseUrl,
            // Enough to recognise the key, never enough to use it.
            hint: stored.apiKey ? `••••${stored.apiKey.slice(-4)}` : '',
            updatedAt: stored.updatedAt,
          }
        : null,
      providers: PROVIDERS,
    })
  })

  /**
   * Saves a key the student supplies themselves. It is used for their requests
   * only, and the key is never returned by any endpoint.
   */
  app.put('/api/ai/settings', async (c) => {
    const body = await readBody(c.req.raw)
    if (!body) return c.json({ error: 'That key could not be saved.' }, 400)
    const provider = PROVIDER_IDS.find((id) => id === body.provider)
    if (!provider)
      return c.json({ error: 'Pick a service from the list.' }, 400)
    const info = PROVIDERS.find((item) => item.id === provider)
    if (!info) return c.json({ error: 'Pick a service from the list.' }, 400)

    const apiKey = clean(body.apiKey, 400)
    const model = clean(body.model, 80)
    const baseUrl = clean(body.baseUrl, 200)
    // Keys are opaque tokens: printable, no spaces, and long enough to be real.
    const wellFormed = /^[\x21-\x7e]{8,400}$/.test(apiKey)
    if (info.needsKey && !wellFormed)
      return c.json(
        { error: 'Paste the API key exactly as the service shows it.' },
        400,
      )
    if (!info.needsKey && apiKey && !wellFormed)
      return c.json({ error: 'That API key does not look right.' }, 400)
    if (baseUrl && !/^https?:\/\/[^\s]+$/.test(baseUrl))
      return c.json({ error: 'A base URL must start with http:// or https://.' }, 400)
    if (provider === 'custom' && (!baseUrl || !model))
      return c.json(
        { error: 'A custom service needs a base URL and a model name.' },
        400,
      )
    if (
      !providerFromSettings({ provider, apiKey: apiKey || undefined, model, baseUrl })
    )
      return c.json(
        { error: 'That provider, key and URL combination cannot work.' },
        400,
      )

    await saveAiKey(db, BASE_OWNER, {
      provider,
      model,
      baseUrl,
      apiKey,
    })
    return c.json({ ok: true })
  })

  app.delete('/api/ai/settings', async (c) => {
    await clearAiKey(db, BASE_OWNER)
    return c.json({ ok: true })
  })

  const AI_SETUP =
    'The AI study desk is not connected yet. Paste an API key in the study desk, or set one on the server. Everything else works without it.'
  const AI_FAILED = 'The AI service did not answer. Please try again in a moment.'

  app.post('/api/ai/summarize', async (c) => {
    const owner = c.get('owner')
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const body = await readBody(c.req.raw)
    const sources = await sourceNotes(db, owner, body)
    if (!sources.length)
      return c.json(
        { error: 'Write a note first. There is nothing to summarise yet.' },
        400,
      )
    const quota = await consumeAi(db, owner)
    if (!quota.ok)
      return c.json(
        { error: `You have used today’s ${AI_DAILY_LIMIT} AI actions. They reset tomorrow.` },
        429,
      )
    try {
      const summary = await summariseNotes(
        provider,
        sources,
        await syllabusContext(db, owner),
      )
      return c.json({ answer: summary, remaining: quota.remaining })
    } catch (error) {
      return c.json(
        { error: error instanceof AiError ? error.message : AI_FAILED },
        502,
      )
    }
  })

  app.post('/api/ai/ask', async (c) => {
    const body = await readBody(c.req.raw)
    const question = clean(body?.question, 500)
    if (!question)
      return c.json({ error: 'Ask a question of up to 500 characters.' }, 400)
    const owner = c.get('owner')
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const sources = await sourceNotes(db, owner, body)
    if (!sources.length)
      return c.json(
        { error: 'Write a note first. The assistant answers from your notes.' },
        400,
      )
    const quota = await consumeAi(db, owner)
    if (!quota.ok)
      return c.json(
        { error: `You have used today’s ${AI_DAILY_LIMIT} AI actions. They reset tomorrow.` },
        429,
      )
    try {
      const answer = await askNotes(
        provider,
        question,
        sources,
        await syllabusContext(db, owner),
      )
      return c.json({ answer, remaining: quota.remaining })
    } catch (error) {
      return c.json(
        { error: error instanceof AiError ? error.message : AI_FAILED },
        502,
      )
    }
  })

  app.notFound((c) =>
    c.req.path === '/api' || c.req.path.startsWith('/api/')
      ? c.json({ error: 'Endpoint not found.' }, 404)
      : c.text('Not found', 404),
  )
  app.onError((error, c) => {
    // A local app has a terminal to read, so print what actually broke.
    console.error('Request failed', error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })
  return app
}
