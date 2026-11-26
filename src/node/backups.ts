import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Copies of everything, written beside the data file while the app is used.
 * They are the same JSON as the Download a backup button, so a copy can be put
 * back with Import a backup without any other tool.
 */

/** How many automatic copies stay on disk; the oldest goes first. */
export const BACKUP_KEEP = 7

/** Requests that can empty or replace something, so they earn a copy first. */
const DESTRUCTIVE = [
  /^\/api\/workspace$/,
  /^\/api\/import$/,
  /^\/api\/setup$/,
  /^\/api\/notebooks\/[^/]+$/,
]

const HOUR = 60 * 60 * 1000
const HALF_HOUR = 30 * 60 * 1000

/** The folder automatic copies live in: next to the database, not inside it. */
export function backupFolder(databasePath: string): string {
  return join(dirname(databasePath), 'backups')
}

/** The automatic copies, oldest first, because the names sort by time. */
export function backupFiles(databasePath: string): string[] {
  const folder = backupFolder(databasePath)
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => name.startsWith('studydeck-') && name.endsWith('.json'))
    .sort()
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

export type BackupReader = () => Promise<string | null>

/** Writes one copy and drops everything past `keep`. Null when it was empty. */
export async function writeBackup(
  databasePath: string,
  read: BackupReader,
  keep = BACKUP_KEEP,
): Promise<string | null> {
  const body = await read()
  if (!body || !worthKeeping(body)) return null

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

  const files = backupFiles(databasePath)
  for (const old of files.slice(0, Math.max(0, files.length - keep)))
    rmSync(join(folder, old))
  return file
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
  let tail: Promise<void> = Promise.resolve()

  const copy = async (): Promise<void> => {
    try {
      const file = await writeBackup(databasePath, read, keep)
      if (file) last = now()
    } catch (error) {
      console.error('Could not write an automatic backup.', error)
    }
  }

  const queued = (): Promise<void> => {
    pending += 1
    tail = tail
      .then(copy)
      .finally(() => {
        pending -= 1
      })
    return tail
  }

  return {
    async startup() {
      if (now() - newestBackupAt(databasePath) < HOUR) return
      await queued()
    },
    async before(method, path) {
      if (!isWrite(method) || !DESTRUCTIVE.some((pattern) => pattern.test(path)))
        return
      // This request may wipe what is there, so wait for the copy to land.
      if (pending > 0) await tail
      if (pending > 0) return
      await queued()
    },
    after(method, path, ok) {
      if (!ok || !isWrite(method) || pending > 0) return
      if (last && now() - last < HALF_HOUR) return
      void queued()
    },
    flush: () => tail,
  }
}
