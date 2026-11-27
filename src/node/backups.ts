import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { BackupEntry } from '../shared/types.ts'
import type { BackupStore } from '../server/app.ts'

/**
 * Copies of everything, written beside the data file while the app is used.
 * They are the same JSON as the Download a backup button, so a copy can be put
 * back with Import a backup without any other tool — or from Settings, which
 * lists them.
 */

/** How many automatic copies stay on disk; the oldest goes first. */
export const BACKUP_KEEP = 7

/**
 * Requests that empty a notebook. The copy has to land before the request
 * runs: a wipe is never allowed without something to put back.
 */
const EMPTIES: { method: string; pattern: RegExp }[] = [
  { method: 'DELETE', pattern: /^\/api\/workspace$/ },
  { method: 'DELETE', pattern: /^\/api\/notebooks\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/backups\/[^/]+\/restore$/ },
]

/** Requests that replace something: they earn a copy, but can go ahead. */
const REPLACES: { method: string; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/api\/setup$/ },
  { method: 'POST', pattern: /^\/api\/import$/ },
]

/** A restore is the one request that must not prune the copy it is putting back. */
const RESTORE = /^\/api\/backups\/([^/]+)\/restore$/

const matches = (list: typeof EMPTIES, method: string, path: string) =>
  list.some((entry) => entry.method === method && entry.pattern.test(path))

const HOUR = 60 * 60 * 1000
const HALF_HOUR = 30 * 60 * 1000

/**
 * A request that would empty a notebook had no copy of what it is about to
 * lose, so it is refused and nothing is deleted. The server turns this into a
 * 503 with the same words.
 */
export class BackupFailed extends Error {
  constructor() {
    super(
      'Studydeck could not write a copy of this notebook, so it left it as it is. Check that the backups folder beside the data file can be written, then try again.',
    )
    this.name = 'BackupFailed'
  }
}

/** Null unless the error is the refusal above, so it is a 503 and not a crash. */
export function backupRefusal(error: unknown): Response | null {
  return error instanceof BackupFailed
    ? Response.json({ error: error.message }, { status: 503 })
    : null
}

/** The folder automatic copies live in: next to the database, not inside it. */
export function backupFolder(databasePath: string): string {
  return join(dirname(databasePath), 'backups')
}

/** The automatic copies, oldest first, because the names sort by time. */
export function backupFiles(databasePath: string): string[] {
  const folder = backupFolder(databasePath)
  if (!existsSync(folder)) return []
  try {
    return readdirSync(folder)
      .filter((name) => name.startsWith('studydeck-') && name.endsWith('.json'))
      .sort()
  } catch {
    // Something other than a folder with that name: there are no copies to list.
    return []
  }
}

function newestBackupAt(databasePath: string): number {
  const newest = backupFiles(databasePath).at(-1)
  return newest
    ? statSync(join(backupFolder(databasePath), newest)).mtimeMs
    : 0
}

/**
 * A fresh install has nothing worth keeping, so it never fills the folder with
 * empty copies. Anything a backup can hold counts, including a class setup.
 */
export function worthKeeping(body: string): boolean {
  try {
    const file = JSON.parse(body) as {
      profile?: unknown
      notebooks?: Record<string, unknown>[]
    }
    if (file.profile) return true
    return (file.notebooks ?? []).some((part) =>
      [
        'subjects',
        'entries',
        'tasks',
        'notes',
        'actions',
        'days',
        'syllabus',
        'sources',
        'library',
        'reviews',
        'reviewLog',
      ].some((key) => Array.isArray(part[key]) && part[key]!.length > 0),
    )
  } catch {
    return false
  }
}

/** Writes one copy of a workspace that is known to hold something. */
function writeCopy(
  databasePath: string,
  body: string,
  keep: number,
  protect?: string,
): string {
  const folder = backupFolder(databasePath)
  mkdirSync(folder, { recursive: true })
  // A fixed-width sequence keeps two copies from the same millisecond in the
  // order they were written, so the oldest is always the one dropped.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let file = join(folder, `studydeck-${stamp}-001.json`)
  for (let sequence = 2; existsSync(file); sequence += 1)
    file = join(
      folder,
      `studydeck-${stamp}-${String(sequence).padStart(3, '0')}.json`,
    )

  // A copy is only a copy once it is whole: write beside it, then rename.
  writeFileSync(`${file}.part`, body)
  renameSync(`${file}.part`, file)

  const files = backupFiles(databasePath).filter((name) => name !== protect)
  for (const old of files.slice(0, Math.max(0, files.length - keep)))
    rmSync(join(folder, old))
  return file
}

export type BackupReader = () => Promise<string | null>

/** Writes one copy and drops everything past `keep`. Null when it was empty. */
export async function writeBackup(
  databasePath: string,
  read: BackupReader,
  keep = BACKUP_KEEP,
): Promise<string | null> {
  const body = await read()
  if (!body || !worthKeeping(body)) return null
  return writeCopy(databasePath, body, keep)
}

/** One line for the Settings list: how much each copy holds. */
function summarise(body: string): string {
  try {
    const file = JSON.parse(body) as { notebooks?: Record<string, unknown>[] }
    const books = file.notebooks ?? []
    const count = (key: string) =>
      books.reduce(
        (total, book) =>
          total + (Array.isArray(book[key]) ? book[key]!.length : 0),
        0,
      )
    const notes = count('notes')
    const tasks = count('tasks')
    const parts = [`${books.length} notebook${books.length === 1 ? '' : 's'}`]
    if (notes) parts.push(`${notes} note${notes === 1 ? '' : 's'}`)
    if (tasks) parts.push(`${tasks} task${tasks === 1 ? '' : 's'}`)
    return parts.join(' · ')
  } catch {
    return 'A copy that could not be read'
  }
}

/** The automatic copies, newest first, with what each one holds. */
export function listBackups(databasePath: string): BackupEntry[] {
  return backupFiles(databasePath)
    .reverse()
    .map((name) => {
      const file = join(backupFolder(databasePath), name)
      const info = statSync(file)
      return {
        name,
        writtenAt: info.mtimeMs,
        bytes: info.size,
        summary: summarise(readFileSync(file, 'utf8')),
      }
    })
}

/**
 * The copies as the app sees them. The app layer never touches the disk: it
 * lists and reads through this, and a name it did not just list is refused.
 */
export function fileBackups(databasePath: string): BackupStore {
  return {
    list: () => listBackups(databasePath),
    read: (name) => {
      if (!backupFiles(databasePath).includes(name)) return null
      try {
        return readFileSync(join(backupFolder(databasePath), name), 'utf8')
      } catch {
        return null
      }
    },
  }
}

export type AutomaticBackups = {
  /** One copy at startup, at most once an hour. */
  startup(): Promise<void>
  /** Before a request that empties or replaces something: a copy, awaited. */
  before(method: string, path: string): Promise<void>
  /** After a write that worked: a copy, at most every half hour. */
  after(method: string, path: string, ok: boolean): void
  /** Resolves once every queued copy has been written. */
  flush(): Promise<void>
}

const isWrite = (method: string) => method !== 'GET' && method !== 'HEAD'

type CopyResult = 'written' | 'empty' | 'failed'

/**
 * The rolling policy: a copy when the server starts, a copy before a
 * destructive request, and one every half hour of editing. Writes are
 * serialised, so two requests can never half-overwrite each other.
 */
export function automaticBackups(
  databasePath: string,
  read: BackupReader,
  options: { keep?: number; now?: () => number } = {},
): AutomaticBackups {
  const keep = options.keep ?? BACKUP_KEEP
  const now = options.now ?? Date.now
  let last = 0
  let pending = 0
  let tail: Promise<unknown> = Promise.resolve()

  const copy = async (protect?: string): Promise<CopyResult> => {
    try {
      const body = await read()
      // A workspace the app could not hand over is not an empty one.
      if (body === null) return 'failed'
      if (!worthKeeping(body)) return 'empty'
      writeCopy(databasePath, body, keep, protect)
      last = now()
      return 'written'
    } catch (error) {
      console.error('Could not write an automatic backup.', error)
      return 'failed'
    }
  }

  const queued = (protect?: string): Promise<CopyResult> => {
    pending += 1
    const next = tail.then(() => copy(protect)).finally(() => {
      pending -= 1
    })
    tail = next
    return next
  }

  return {
    async startup() {
      if (now() - newestBackupAt(databasePath) < HOUR) return
      await queued()
    },
    async before(method, path) {
      if (!isWrite(method)) return
      const empties = matches(EMPTIES, method, path)
      if (!empties && !matches(REPLACES, method, path)) return
      const protect = RESTORE.exec(path)?.[1]
      // This request may wipe what is there, so wait for the copy to land.
      const result = await queued(protect ? decodeURIComponent(protect) : undefined)
      if (!empties || result !== 'failed') return
      // Refuse the wipe rather than delete what could not be copied.
      throw new BackupFailed()
    },
    after(method, path, ok) {
      if (!ok || !isWrite(method) || pending > 0) return
      if (last && now() - last < HALF_HOUR) return
      void queued()
    },
    flush: () => tail.then(() => undefined),
  }
}

/** A Hono app, as much of it as reading a copy needs. */
export type BackupApp = {
  fetch(request: Request): Response | Promise<Response>
}

/**
 * Automatic copies of a real data file, read from the app's own export route
 * so every copy is exactly the file Import a backup reads.
 */
export function backupsFor(
  databasePath: string,
  app: BackupApp,
): AutomaticBackups | null {
  if (databasePath === ':memory:') return null
  return automaticBackups(databasePath, async () => {
    try {
      const response = await app.fetch(
        new Request('http://localhost/api/export'),
      )
      return response.ok ? await response.text() : null
    } catch (error) {
      console.error('Could not read the workspace for a backup.', error)
      return null
    }
  })
}
