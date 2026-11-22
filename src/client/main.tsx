import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session, WorkspaceData } from '../shared/types'
import { api } from './api'
import Landing from './Landing'
import Shell from './Shell'
import { WorkspaceProvider } from './workspace'
import './style.css'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const current = await api<Session>('/api/session')
        if (!live) return
        setSession(current)
        if (current.user && current.database) {
          const workspace = await api<WorkspaceData>('/api/data')
          if (live) setData(workspace)
        }
      } catch (e) {
        if (live)
          setError(e instanceof Error ? e.message : 'Could not load Studydeck.')
      } finally {
        if (live) setReady(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  if (!ready) return <div className="boot">Opening your workspace…</div>
  if (!session)
    return (
      <div className="boot">
        {error || 'Studydeck could not reach the server. Please refresh.'}
      </div>
    )
  if (!session.user || !session.database || !data)
    return (
      <Landing
        session={session}
        message={
          error ||
          (session.database
            ? ''
            : 'Your workspace database is still being set up. Please try again in a moment.')
        }
      />
    )
  return (
    <WorkspaceProvider initial={data}>
      <Shell session={session} />
    </WorkspaceProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
