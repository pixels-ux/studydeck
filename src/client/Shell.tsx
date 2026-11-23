import { useEffect, useState } from 'react'
import Home from './Home'
import Library from './Library'
import Notes from './Notes'
import Setup from './Setup'
import StudyDesk from './StudyDesk'
import Syllabus from './Syllabus'
import Timetable from './Timetable'
import Work from './Work'
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

/** `#/notes` and friends, so a reload or a bookmark keeps the tab. */
function tabFromHash(): Tab {
  const id = window.location.hash.replace(/^#\/?/, '')
  return TABS.some((item) => item.id === id) ? (id as Tab) : 'today'
}

export default function Shell() {
  const { data } = useWorkspace()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [editing, setEditing] = useState(false)

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
        <nav className="rail-nav" aria-label="Workspace">
          {needsSetup ? null : (
            <>
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
          <p className="rail-who">On this computer</p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{hint}</p>
            <h1>{title}</h1>
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
              {tab === 'library' && <Library />}
              {tab === 'desk' && <StudyDesk />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
