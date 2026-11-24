import { useEffect, useState } from 'react'
import type { Note, NoteInput } from '../shared/types'
import { fmtDate } from './dates'
import Revision from './Revision'
import { revisionKindOf } from './revision'
import { useWorkspace } from './workspace'

const emptyDraft: NoteInput = { subjectId: null, title: '', body: '' }

function draftOf(note: Note | null): NoteInput {
  return note
    ? { subjectId: note.subjectId, title: note.title, body: note.body }
    : emptyDraft
}

export default function Notes() {
  const { data, saveNote, deleteNote } = useWorkspace()
  const [selectedId, setSelectedId] = useState<string | null>(
    data.notes[0]?.id ?? null,
  )
  const [creating, setCreating] = useState(data.notes.length === 0)
  const [draft, setDraft] = useState<NoteInput>(() =>
    draftOf(data.notes[0] ?? null),
  )
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [revising, setRevising] = useState(false)
  const [error, setError] = useState('')

  const selected = data.notes.find((note) => note.id === selectedId) ?? null

  useEffect(() => {
    if (selected) {
      setDraft(draftOf(selected))
      setCreating(false)
    }
  }, [selected?.id, selected?.updatedAt])

  const dirty =
    creating ||
    !selected ||
    draft.title !== selected.title ||
    draft.body !== selected.body ||
    draft.subjectId !== selected.subjectId

  const filtered = data.notes.filter((note) => {
    if (subjectFilter && note.subjectId !== subjectFilter) return false
    if (!query.trim()) return true
    const haystack = `${note.title} ${note.body}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'
  const subjectColor = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.color ?? '#7b857d'

  function startNew() {
    setCreating(true)
    setSelectedId(null)
    setDraft({ ...emptyDraft, subjectId: subjectFilter || null })
    setError('')
  }

  async function save() {
    if (!draft.body.trim() && !draft.title.trim()) {
      setError('Write something before saving.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await saveNote(
        {
          subjectId: draft.subjectId,
          title: draft.title.trim() || draft.body.split('\n')[0]!.slice(0, 80),
          body: draft.body,
        },
        selected?.id,
      )
      setCreating(false)
      setSelectedId(saved.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this note.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(note: Note) {
    if (!window.confirm(`Delete “${note.title}”?`)) return
    try {
      await deleteNote(note.id)
      const next = data.notes.find((item) => item.id !== note.id) ?? null
      if (next) {
        setSelectedId(next.id)
        setCreating(false)
      } else {
        setSelectedId(null)
        setCreating(true)
        setDraft(emptyDraft)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this note.')
    }
  }

  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0

  return (
    <div className="notes-layout">
      <section className="card note-list">
        <div className="card-head">
          <h3>Notebook</h3>
          <button className="btn primary small" onClick={startNew}>
            New note
          </button>
        </div>
        <input
          className="search"
          value={query}
          placeholder="Search your notes…"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search notes"
        />
        <select
          className="search"
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          aria-label="Filter by subject"
        >
          <option value="">All subjects</option>
          {data.subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        {filtered.length === 0 ? (
          <p className="empty-line">
            {data.notes.length ? 'No notes match that search.' : 'No notes yet.'}
          </p>
        ) : (
          <ul className="note-items">
            {filtered.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={note.id === selectedId ? 'note-item active' : 'note-item'}
                  onClick={() => {
                    setSelectedId(note.id)
                    setCreating(false)
                  }}
                >
                  <span className="note-item-head">
                    <span
                      className="dot"
                      style={{ background: subjectColor(note.subjectId) }}
                    />
                    <strong>{note.title}</strong>
                  </span>
                  <span className="note-item-body">{note.body.slice(0, 90)}</span>
                  <span className="note-item-foot">
                    {subjectName(note.subjectId)} · {fmtDate(new Date(note.updatedAt).toISOString().slice(0, 10))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card note-editor">
        <div className="card-head">
          <h3>{creating ? 'New note' : 'Editing'}</h3>
          <span className="count">
            {dirty ? 'Unsaved changes' : selected ? 'Saved' : ''}
          </span>
        </div>
        <label className="field">
          <span>Title</span>
          <input
            value={draft.title}
            maxLength={120}
            placeholder="Give this note a title"
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Subject</span>
          <select
            value={draft.subjectId ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                subjectId: event.target.value || null,
              }))
            }
          >
            <option value="">General</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Notes</span>
          <textarea
            className="note-body"
            value={draft.body}
            maxLength={8000}
            placeholder="Paste from class, or write it in your own words. The AI study desk works from whatever is here."
            onChange={(event) =>
              setDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
        </label>
        <div className="form-footer">
          <span className="muted">
            {words} words · {draft.body.length}/8000 characters
          </span>
          <div className="form-actions">
            {selected && !creating && revisionKindOf(selected.title) ? (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => setRevising(true)}
              >
                Revise
              </button>
            ) : null}
            {selected && !creating ? (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => void remove(selected)}
              >
                Delete
              </button>
            ) : null}
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : creating ? 'Create note' : 'Save note'}
            </button>
          </div>
        </div>
        {error ? <p className="error small">{error}</p> : null}
      </section>
      {revising && selected ? (
        <Revision note={selected} onClose={() => setRevising(false)} />
      ) : null}
    </div>
  )
}
