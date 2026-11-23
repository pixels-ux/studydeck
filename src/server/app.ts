import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { syllabusBrief } from '../shared/curriculum.ts'
import type {
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
  consumeAi,
  practiceQuestions,
  summariseNotes,
  usedAi,
  type NoteSource,
} from './ai.ts'
import { clearAiKey, effectiveProvider, readAiKey, saveAiKey } from './aiSettings.ts'
import type { Env } from './env'
import { calendarFileName, timetableFile } from './ics.ts'
import { chunkSource, MAX_SOURCE_CHARS, retrieve, search } from './library.ts'
import { AiError, PROVIDER_IDS, PROVIDERS, providerFromSettings } from './providers.ts'
import type { SqlDatabase, SqlStatement } from './sql'
import {
  ensureSchema,
  mapEntry,
  mapLibraryMessage,
  mapNote,
  mapProfile,
  mapSource,
  mapSubject,
  mapTask,
  readProfile,
  type EntryRow,
  type LibraryMessageRow,
  type NoteRow,
  type ProfileRow,
  type SourceRow,
  type SubjectRow,
  type TaskRow,
} from './db.ts'

/** One person uses one copy of Studydeck, so there is a single workspace. */
const LOCAL_OWNER = 'local'

type AppContext = { Variables: { db: SqlDatabase } }

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

const entryColumns =
  'id, subject_id, title, kind, day, start_min, end_min, room, plan, date'
const taskColumns =
  'id, subject_id, title, due_date, priority, done, details, created_at'
const noteColumns = 'id, subject_id, title, body, created_at, updated_at'
const sourceColumns =
  'id, subject_id, title, origin, body, created_at, updated_at'
const messageColumns =
  'id, subject_id, role, body, citations, created_at'
const TRANSFORMS = ['summary', 'questions'] as const
type Transform = (typeof TRANSFORMS)[number]

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

/**
 * The app runs on the student's own machine: one workspace, no accounts. Every
 * write still has to come from this origin so a stray web page in the same
 * browser cannot change the timetable behind their back.
 */
export function createApp(db: SqlDatabase, env: Env = {}) {
  const app = new Hono<AppContext>()
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    if (WRITE_METHODS.has(c.req.method) && !sameOrigin(c.req.raw))
      return c.json({ error: 'Cross-origin request refused.' }, 403)
    await ensureSchema(db)
    await next()
  })
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  )

  /** One payload shape for both the workspace load and a completed setup. */
  async function workspace(db: SqlDatabase, env: Env, owner: string) {
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
        .bind(owner)
        .first<ProfileRow>(),
    ])
    const { provider } = await effectiveProvider(db, env, owner)
    return {
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
        remaining: Math.max(0, AI_DAILY_LIMIT - (await usedAi(db, owner))),
        limit: AI_DAILY_LIMIT,
        provider: provider?.label ?? null,
        model: provider?.model ?? null,
      },
    }
  }

  app.get('/api/data', async (c) =>
    c.json(await workspace(db, env, LOCAL_OWNER)),
  )

  /** Everything the student owns, in one file they can keep. */
  app.get('/api/export', async (c) => {
    const data = await workspace(db, env, LOCAL_OWNER)
    const today = new Date().toISOString().slice(0, 10)
    return c.body(
      JSON.stringify(
        {
          app: 'Studydeck',
          version: 1,
          exportedAt: new Date().toISOString(),
          profile: data.profile,
          subjects: data.subjects,
          entries: data.entries,
          tasks: data.tasks,
          notes: data.notes,
          syllabus: data.syllabus,
          sources: data.sources,
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

  /** The weekly timetable and revision plan, ready for any calendar app. */
  app.get('/api/timetable.ics', async (c) => {
    const rows = await db
      .prepare(
        `SELECT ${entryColumns} FROM entries WHERE owner_sub = ? ORDER BY day ASC, start_min ASC`,
      )
      .bind(LOCAL_OWNER)
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
    const owner = LOCAL_OWNER
    await db.batch([
      db.prepare('DELETE FROM entries WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM tasks WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM study_notes WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM sources WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM library_messages WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM syllabus_progress WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM subjects WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM profiles WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM ai_usage WHERE owner_sub = ?').bind(owner),
      db.prepare('DELETE FROM ai_keys WHERE owner_sub = ?').bind(owner),
    ])
    return c.json(await workspace(db, env, owner))
  })

  /**
   * The class-setup wizard: stores the class and daily schedule, creates or
   * updates the subjects by name, then replaces the generated timetables.
   * Notes and tasks are never touched, so a re-run keeps the student's work.
   */
  app.post('/api/setup', async (c) => {
    const owner = LOCAL_OWNER
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
        owner,
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

    return c.json(await workspace(db, env, owner))
  })

  app.post('/api/subjects', async (c) => {
    const body = await readBody(c.req.raw)
    const input = body ? parseSubject(body) : null
    if (!input)
      return c.json({ error: 'Give the subject a name of 40 characters or fewer.' }, 400)
    const owner = LOCAL_OWNER
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
        LOCAL_OWNER,
      )
      .first<SubjectRow>()
    return row
      ? c.json({ subject: mapSubject(row) })
      : c.json({ error: 'Subject not found.' }, 404)
  })

  app.delete('/api/subjects/:id', async (c) => {
    const owner = LOCAL_OWNER
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
    const owner = LOCAL_OWNER
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
        LOCAL_OWNER,
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
        LOCAL_OWNER,
      )
      .first<EntryRow>()
    return row
      ? c.json({ entry: mapEntry(row) })
      : c.json({ error: 'Block not found.' }, 404)
  })

  app.delete('/api/entries/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM entries WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), LOCAL_OWNER)
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
    const owner = LOCAL_OWNER
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
        LOCAL_OWNER,
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
        LOCAL_OWNER,
      )
      .first<TaskRow>()
    return row
      ? c.json({ task: mapTask(row) })
      : c.json({ error: 'Task not found.' }, 404)
  })

  app.delete('/api/tasks/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM tasks WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), LOCAL_OWNER)
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
        LOCAL_OWNER,
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
        LOCAL_OWNER,
      )
      .first<NoteRow>()
    return row
      ? c.json({ note: mapNote(row) })
      : c.json({ error: 'Note not found.' }, 404)
  })

  app.delete('/api/notes/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM study_notes WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), LOCAL_OWNER)
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
        .bind(input.subjectId, LOCAL_OWNER)
        .first()
      if (!owned) return c.json({ error: 'Subject not found.' }, 404)
    }
    const count = await db
      .prepare('SELECT COUNT(*) AS total FROM sources WHERE owner_sub = ?')
      .bind(LOCAL_OWNER)
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
        LOCAL_OWNER,
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
        LOCAL_OWNER,
      )
      .first<SourceRow>()
    return row
      ? c.json({ source: mapSource(row) })
      : c.json({ error: 'Material not found.' }, 404)
  })

  app.delete('/api/sources/:id', async (c) => {
    const removed = await db
      .prepare('DELETE FROM sources WHERE id = ? AND owner_sub = ? RETURNING id')
      .bind(c.req.param('id'), LOCAL_OWNER)
      .first()
    return removed
      ? c.json({ ok: true })
      : c.json({ error: 'Material not found.' }, 404)
  })

  /** Full-text search across the material, one best paragraph per source. */
  app.get('/api/library/search', async (c) => {
    const query = clean(c.req.query('q'), 200)
    const rawSubject = c.req.query('subjectId')
    const subjectId = rawSubject ? identifier(rawSubject) : null
    if (rawSubject && !subjectId)
      return c.json({ error: 'Subject not found.' }, 404)
    if (!query) return c.json({ results: [] as LibrarySearchHit[] })
    const rows = await librarySources(LOCAL_OWNER, subjectId)
    return c.json({ results: search(chunksOf(rows), query) })
  })

  /** Ask a question of the material and keep the exchange in the notebook. */
  app.post('/api/library/ask', async (c) => {
    const body = await readBody(c.req.raw)
    const question = clean(body?.question, 500)
    const subjectId = optionalIdentifier(body?.subjectId)
    if (!question || subjectId === undefined)
      return c.json({ error: 'Ask a question of up to 500 characters.' }, 400)
    const owner = LOCAL_OWNER
    const { provider } = await effectiveProvider(db, env, owner)
    if (!provider) return c.json({ error: AI_SETUP }, 503)
    const rows = await librarySources(owner, subjectId)
    if (!rows.length)
      return c.json(
        { error: 'Add some material first. Answers come from what you add.' },
        400,
      )
    const cited = retrieve(chunksOf(rows), question)
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
      .bind(LOCAL_OWNER, subjectId)
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
    const kind = TRANSFORMS.find((option) => option === body?.kind)
    if (!sourceId || !kind)
      return c.json(
        { error: 'Pick a piece of material and what to make from it.' },
        400,
      )
    const owner = LOCAL_OWNER
    const row = await db
      .prepare(
        `SELECT ${sourceColumns} FROM sources WHERE id = ? AND owner_sub = ?`,
      )
      .bind(sourceId, owner)
      .first<SourceRow>()
    if (!row) return c.json({ error: 'Material not found.' }, 404)
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
          ? await summariseNotes(
              provider,
              [{ title: row.title, body: row.body }],
              context,
            )
          : await practiceQuestions(
              provider,
              { title: row.title, body: row.body },
              context,
            )
      const now = Date.now()
      const title = `${kind === 'summary' ? 'Summary' : 'Practice questions'} · ${row.title}`.slice(0, 120)
      const note = await db
        .prepare(
          `INSERT INTO study_notes (id, owner_sub, subject_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${noteColumns}`,
        )
        .bind(
          crypto.randomUUID(),
          owner,
          row.subject_id,
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
    const owner = LOCAL_OWNER
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

    await saveAiKey(db, LOCAL_OWNER, {
      provider,
      model,
      baseUrl,
      apiKey,
    })
    return c.json({ ok: true })
  })

  app.delete('/api/ai/settings', async (c) => {
    await clearAiKey(db, LOCAL_OWNER)
    return c.json({ ok: true })
  })

  const AI_SETUP =
    'The AI study desk is not connected yet. Paste an API key in the study desk, or set one on the server. Everything else works without it.'
  const AI_FAILED = 'The AI service did not answer. Please try again in a moment.'

  app.post('/api/ai/summarize', async (c) => {
    const owner = LOCAL_OWNER
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
    const owner = LOCAL_OWNER
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
