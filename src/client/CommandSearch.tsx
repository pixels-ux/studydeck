import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { SEARCH_KINDS, searchEverything, type SearchHit } from './search'
import { useWorkspace } from './workspace'

/** The one search box, opened from the top bar or with ⌘K / Ctrl+K. */
export default function CommandSearch({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (hit: SearchHit) => void
}) {
  const { data } = useWorkspace()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchEverything(data, query), [data, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const focus = window.setTimeout(() => field.current?.focus(), 0)
    return () => window.clearTimeout(focus)
  }, [open])

  useEffect(() => setActive(0), [query])

  if (!open) return null

  const move = (delta: number) => {
    if (!hits.length) return
    setActive((current) => (current + delta + hits.length) % hits.length)
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[active]
      if (hit) onPick(hit)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const typed = query.trim().length >= 2

  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="command"
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={field}
          className="command-input"
          value={query}
          placeholder="Search notes, material, work, chapters, notebooks…"
          aria-label="Search everything"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keys}
        />
        <div className="command-results">
          {!typed ? (
            <p className="command-empty">
              Type two letters or more. This notebook’s notes, material, work and
              chapters are searched, and your other notebooks by name.
            </p>
          ) : hits.length === 0 ? (
            <p className="command-empty">Nothing found for “{query.trim()}”.</p>
          ) : (
            SEARCH_KINDS.map((group) => {
              const rows = hits.filter((hit) => hit.kind === group.kind)
              if (!rows.length) return null
              return (
                <div className="command-group" key={group.kind}>
                  <p className="command-group-label">{group.label}</p>
                  {rows.map((hit) => {
                    const index = hits.indexOf(hit)
                    return (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        type="button"
                        className={
                          index === active ? 'command-hit active' : 'command-hit'
                        }
                        onMouseEnter={() => setActive(index)}
                        onClick={() => onPick(hit)}
                      >
                        <span className="command-hit-copy">
                          <strong>{hit.title}</strong>
                          {hit.snippet ? <span>{hit.snippet}</span> : null}
                        </span>
                        <span className="command-hit-detail">{hit.detail}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
        <div className="command-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
