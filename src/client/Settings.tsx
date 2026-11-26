import ApiKeys from './ApiKeys'
import type { ThemeChoice } from './theme'
import { useWorkspace } from './workspace'

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export default function Settings({
  theme,
  onTheme,
  onOpenSetup,
}: {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  onOpenSetup: () => void
}) {
  const { data } = useWorkspace()

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
          seven. Any of them loads back with Import a backup in class setup.
        </p>
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
