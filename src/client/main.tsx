import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkspaceData } from '../shared/types'
import { api } from './api'
import Shell from './Shell'
import { WorkspaceProvider } from './workspace'
import './style.css'

function App() {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api<WorkspaceData>('/api/data')
      .then((workspace) => {
        if (live) setData(workspace)
      })
      .catch((e) => {
        if (live)
          setError(
            e instanceof Error ? e.message : 'Could not open your workspace.',
          )
      })
    return () => {
      live = false
    }
  }, [])

  if (error) return <div className="boot">{error}</div>
  if (!data) return <div className="boot">Opening your workspace…</div>
  return (
    <WorkspaceProvider initial={data}>
      <Shell />
    </WorkspaceProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
