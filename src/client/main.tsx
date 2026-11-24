import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkspaceData } from '../shared/types'
import { api, rememberNotebook } from './api'
import Shell from './Shell'
import { WorkspaceProvider } from './workspace'
import { applyTheme, rememberTheme, themeChoice } from './theme'
import './style.css'

// The page was already painted by the inline script in index.html; this keeps
// the check in sync and starts following the system from now on.
applyTheme(themeChoice())
rememberTheme(themeChoice())

function App() {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api<WorkspaceData>('/api/data')
      .then((workspace) => {
        if (!live) return
        // The server may have picked a different book than the stored one.
        rememberNotebook(workspace.notebookId)
        setData(workspace)
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
