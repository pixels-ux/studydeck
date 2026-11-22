import { useState } from 'react'
import type { Session } from '../shared/types'
import Home from './Home'
import Notes from './Notes'
import Setup from './Setup'
import StudyDesk from './StudyDesk'
import Syllabus from './Syllabus'
import Timetable from './Timetable'
import Work from './Work'
import { useWorkspace } from './workspace'

export type Tab = 'today' | 'timetable' | 'work' | 'syllabus' | 'notes' | 'desk'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'today', label: 'Today', hint: 'Classes, work and exams' },
  { id: 'timetable', label: 'Timetable', hint: 'Your week and revision plan' },
  { id: 'work', label: 'Work', hint: 'Assignments and deadlines' },
  { id: 'syllabus', label: 'Syllabus', hint: 'NCERT chapters you have covered' },
  { id: 'notes', label: 'Notes', hint: 'Everything you have written' },
  { id: 'desk', label: 'AI study desk', hint: 'Summaries and answers from your notes' },
]

export default function Shell({ session }: { session: Session }) {
  const { data } = useWorkspace()
  const [tab, setTab] = useState<Tab>('today')
  const [editing, setEditing] = useState(false)
  const active = TABS.find((item) => item.id === tab) ?? TABS[0]!
  const who = session.user?.name || session.user?.email || 'Signed in'
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
                  onClick={() => {
                    setEditing(false)
                    setTab(item.id)
                  }}
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
          {session.mode === 'local' ? (
            <span className="badge">Local preview</span>
          ) : null}
          {data.profile ? (
            <span className="rail-class">Class {data.profile.classLevel} · CBSE</span>
          ) : null}
          <p className="rail-who" title={who}>
            {who}
          </p>
          <form method="post" action="/auth/freebuff/signout">
            <button className="rail-signout">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{hint}</p>
            <h1>{title}</h1>
          </div>
          {session.mode === 'local' ? (
            <p className="topbar-note">
              Local preview. Published sites use your Freebuff account.
            </p>
          ) : null}
        </header>
        <div className="content">
          {needsSetup || editing ? (
            <Setup onDone={() => setEditing(false)} />
          ) : (
            <>
              {tab === 'today' && <Home onNavigate={setTab} />}
              {tab === 'timetable' && <Timetable />}
              {tab === 'work' && <Work />}
              {tab === 'syllabus' && <Syllabus />}
              {tab === 'notes' && <Notes />}
              {tab === 'desk' && <StudyDesk />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
