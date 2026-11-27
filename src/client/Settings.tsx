import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry } from '../shared/types'
import { api } from './api'
import ApiKeys from './ApiKeys'
import type { ThemeChoice } from './theme'
import { useWorkspace } from './workspace'

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/** "27 Nov, 18:04" — short enough for a list, exact enough to choose from. */
function writtenAt(stamp: number): string {
  return new Date(stamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sizeOf(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Settings({
  theme,
  onTheme,
  onOpenSetup,
}: {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  onOpenSetup: () => void
}) {
  const { data, refresh } = useWorkspace()
  const [copies, setCopies] = useState<BackupEntry[] | null>(null)
  const [copyError, setCopyError] = useState('')
  const [restoring, setRestoring] = useState('')
  const [notice, setNotice] = useState('')

  const loadCopies = useCallback(async () => {
    try {
      const result = await api<{ backups: BackupEntry[] }>('/api/backups')
      setCopies(result.backups)
    } catch (e) {
      setCopies([])
      setCopyError(
        e instanceof Error
          ? e.message
          : 'The automatic copies could not be read.',
      )
    }
  }, [])

  useEffect(() => {
    void loadCopies()
  }, [loadCopies])

  async function restoreCopy(copy: BackupEntry) {
    const when = writtenAt(copy.writtenAt)
    const proceed = window.confirm(
      `Put back the copy from ${when}?\n\nEvery notebook is replaced with what that copy holds. The workspace as it is now is kept as a new automatic copy first, so you can come back to it.`,
    )
    if (!proceed) return
    setRestoring(copy.name)
    setCopyError('')
    setNotice('')
    try {
      await api<unknown>(`/api/backups/${encodeURIComponent(copy.name)}/restore`, {
        method: 'POST',
      })
      await refresh()
      await loadCopies()
      setNotice(`Put back the copy from ${when}.`)
    } catch (e) {
      setCopyError(
        e instanceof Error ? e.message : 'That copy could not be put back.',
      )
    } finally {
      setRestoring('')
    }
  }

  return (
    <div className="stack">
      <ApiKeys />

      <section className="card">
        <div className="card-head">
          <h3>Appearance</h3>
          <span className="count">
            {THEMES.find((item) => item.id === theme)?.label ?? 'Auto'} theme
          </span>
        </div>
        <p className="muted">
          Auto follows the light or dark setting of this device. Light and Dark
          stay put until you change them, and the browser&rsquo;s own toolbar is
          painted to match.
        </p>
        <div className="theme-picker" role="group" aria-label="Colour theme">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                theme === option.id ? 'theme-option active' : 'theme-option'
              }
              aria-pressed={theme === option.id}
              onClick={() => onTheme(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="fineprint">
          The choice is remembered in this browser only.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Keyboard</h3>
          <span className="count">Works anywhere</span>
        </div>
        <ul className="shortcut-list">
          <li>
            <span className="shortcut-keys">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
              <span className="shortcut-or">or</span>
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
            </span>
            <span>Search notes, material, work, chapters and notebooks</span>
          </li>
          <li>
            <span className="shortcut-keys">
              <kbd>Esc</kbd>
            </span>
            <span>Close the search</span>
          </li>
          <li>
            <span className="shortcut-keys">
              <kbd>Space</kbd>
            </span>
            <span>Show the answer while reviewing</span>
          </li>
          <li>
            <span className="shortcut-keys">
              <kbd>1</kbd>
              <kbd>2</kbd>
              <kbd>3</kbd>
              <kbd>4</kbd>
            </span>
            <span>Again, Hard, Good, Easy — once the answer is showing</span>
          </li>
        </ul>
        <p className="fineprint">
          The tab title carries the number of cards due, so another tab shows
          what is waiting.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Your data</h3>
          <span className="count">
            {data.notebooks.length} notebook
            {data.notebooks.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="muted">
          Every notebook, note, timetable, task and library chat lives in one
          SQLite file on this server. Keep a copy as a JSON file whenever you
          like, or open class setup to import a backup, change your timetable or
          empty a notebook.
        </p>
        <p className="fineprint">
          Studydeck also writes a rolling copy on its own — before anything can
          be emptied, and now and then while you work — into a{' '}
          <code>backups</code> folder beside the data file, keeping the newest
          seven. If that copy cannot be written, the delete stops instead of
          going ahead. Put any of them back below.
        </p>
        <div className="backup-list">
          <div className="backup-head">
            <h4>Automatic backups</h4>
            <span className="count">
              {copies === null ? 'Reading the folder' : `${copies.length} kept`}
            </span>
          </div>
          {copies === null ? null : copies.length === 0 ? (
            <p className="muted">
              No copies yet. One is written when Studydeck starts, and again
              before anything can be emptied.
            </p>
          ) : (
            <ul className="backup-rows">
              {copies.map((copy) => (
                <li key={copy.name}>
                  <span className="backup-when">
                    <strong>{writtenAt(copy.writtenAt)}</strong>
                    <span className="muted">
                      {copy.summary} · {sizeOf(copy.bytes)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={Boolean(restoring)}
                    onClick={() => void restoreCopy(copy)}
                  >
                    {restoring === copy.name ? 'Putting back…' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {copyError ? <p className="error">{copyError}</p> : null}
          {notice ? <p className="fineprint">{notice}</p> : null}
        </div>
        <div className="form-actions">
          <a className="btn ghost" href="/api/export" download>
            Download a backup
          </a>
          <button type="button" className="btn ghost" onClick={onOpenSetup}>
            Open class setup
          </button>
        </div>
      </section>
    </div>
  )
}
