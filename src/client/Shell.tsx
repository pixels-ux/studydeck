import { useEffect, useState } from 'react'
import { fmtDateLong, todayISO } from './dates'
import Home from './Home'
import Library from './Library'
import Notes from './Notes'
import Setup from './Setup'
import StudyDesk from './StudyDesk'
import Syllabus from './Syllabus'
import Timetable from './Timetable'
import Work from './Work'
import { rememberTheme, themeChoice, type ThemeChoice } from './theme'
import { useWorkspace } from './workspace'

export type Tab =
  | 'today'
  | 'timetable'
  | 'work'
  | 'syllabus'
  | 'notes'
  | 'library'
  | 'desk'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'today', label: 'Today', hint: 'Classes, work and exams' },
  { id: 'timetable', label: 'Timetable', hint: 'Your week and revision plan' },
  { id: 'work', label: 'Work', hint: 'Assignments and deadlines' },
  { id: 'syllabus', label: 'Syllabus', hint: 'NCERT chapters you have covered' },
  { id: 'notes', label: 'Notes', hint: 'Everything you have written' },
  {
    id: 'library',
    label: 'Library',
    hint: 'Your material, searched and answered with citations',
  },
  { id: 'desk', label: 'AI study desk', hint: 'Summaries and answers from your notes' },
]

const THEMES = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const

/** `#/notes` and friends, so a reload or a bookmark keeps the tab. */
function tabFromHash(): Tab {
  const id = window.location.hash.replace(/^#\/?/, '')
  return TABS.some((item) => item.id === id) ? (id as Tab) : 'today'
}

export default function Shell() {
  const {
    data,
    switchNotebook,
    createNotebook,
    renameNotebook,
    deleteNotebook,
  } = useWorkspace()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [editing, setEditing] = useState(false)
  const [bookError, setBookError] = useState('')
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)

  const pickTheme = (choice: ThemeChoice) => {
    rememberTheme(choice)
    setTheme(choice)
  }

  const run = async (work: () => Promise<void>) => {
    setBookError('')
    try {
      await work()
    } catch (error) {
      setBookError(
        error instanceof Error ? error.message : 'Could not change notebooks.',
      )
    }
  }

  const addNotebook = () => {
    const name = window.prompt('Name this notebook', '')
    if (name?.trim()) return run(() => createNotebook(name.trim()))
  }

  const editNotebook = () => {
    const open = data.notebooks.find((item) => item.id === data.notebookId)
    const name = window.prompt('Rename this notebook', open?.name ?? '')
    if (name?.trim() && name.trim() !== open?.name)
      return run(() => renameNotebook(data.notebookId, name.trim()))
  }

  const dropNotebook = () => {
    const open = data.notebooks.find((item) => item.id === data.notebookId)
    if (!open) return
    const agreed = window.confirm(
      `Delete “${open.name}” and everything in it? Your other notebooks stay.`,
    )
    if (agreed) return run(() => deleteNotebook(open.id))
  }

  useEffect(() => {
    const sync = () => {
      setTab(tabFromHash())
      setEditing(false)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const go = (next: Tab) => {
    setEditing(false)
    setTab(next)
    if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`
  }
  const active = TABS.find((item) => item.id === tab) ?? TABS[0]!
  const needsSetup = !data.profile

  const title = needsSetup || editing ? 'Class setup' : active.label
  const hint =
    needsSetup || editing
      ? 'CBSE · your class, your day, your tests'
      : active.hint

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-top">
          <span className="wordmark light">
            Studydeck<span className="wordmark-dot">.</span>
          </span>
          <p className="rail-tag">Timetable, work and notes.</p>
        </div>
        <div className="rail-books">
          <label className="rail-book-label" htmlFor="notebook-pick">
            Notebook
          </label>
          <select
            id="notebook-pick"
            className="rail-book-select"
            value={data.notebookId}
            onChange={(event) =>
              void run(() => switchNotebook(event.target.value))
            }
          >
            {data.notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
          <div className="rail-book-actions">
            <button
              type="button"
              className="rail-mini"
              onClick={() => void addNotebook()}
            >
              New
            </button>
            <button
              type="button"
              className="rail-mini"
              onClick={() => void editNotebook()}
            >
              Rename
            </button>
            {data.notebooks.length > 1 ? (
              <button
                type="button"
                className="rail-mini"
                onClick={() => void dropNotebook()}
              >
                Delete
              </button>
            ) : null}
          </div>
          {bookError ? <p className="rail-error">{bookError}</p> : null}
        </div>
        <nav className="rail-nav" aria-label="Workspace">
          {needsSetup ? null : (
            <>
              <p className="rail-section">Workspace</p>
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={!editing && item.id === tab ? 'rail-link active' : 'rail-link'}
                  aria-current={!editing && item.id === tab ? 'page' : undefined}
                  onClick={() => go(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={editing ? 'rail-link active' : 'rail-link'}
                onClick={() => setEditing(true)}
              >
                Class setup
              </button>
            </>
          )}
        </nav>
        <div className="rail-foot">
          {data.profile ? (
            <span className="rail-class">Class {data.profile.classLevel} · CBSE</span>
          ) : null}
          <div className="theme-switch" role="group" aria-label="Colour theme">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  theme === option.id ? 'theme-option active' : 'theme-option'
                }
                aria-pressed={theme === option.id}
                onClick={() => pickTheme(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="rail-who">On this computer</p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-inner">
            <div>
              <p className="eyebrow">{hint}</p>
              <h1>{title}</h1>
            </div>
            <p className="topbar-note">{fmtDateLong(todayISO())}</p>
          </div>
        </header>
        <div className="content">
          {needsSetup || editing ? (
            <Setup onDone={() => setEditing(false)} />
          ) : (
            <>
              {tab === 'today' && <Home onNavigate={go} />}
              {tab === 'timetable' && <Timetable />}
              {tab === 'work' && <Work />}
              {tab === 'syllabus' && <Syllabus />}
              {tab === 'notes' && <Notes />}
              {tab === 'library' && <Library onNavigate={go} />}
              {tab === 'desk' && <StudyDesk onNavigate={go} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
