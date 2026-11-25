import { useState, type FormEvent } from 'react'
import type { AiAction, Note } from '../shared/types'
import { api } from './api'
import Prose from './Prose'
import { useWorkspace } from './workspace'

const MAX_PROMPT = 2_000
const NEW = 'new'

/**
 * Saved prompts. An instruction is written once, then run over one note or a
 * subject's material; the answer is kept as a note that can be edited.
 */
export default function Actions({
  onNavigate,
}: {
  onNavigate?: (tab: 'notes') => void
}) {
  const { data, saveAction, deleteAction, adoptNote, setAiRemaining } =
    useWorkspace()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState('')
  const [target, setTarget] = useState('')
  const [made, setMade] = useState<Note | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const ready = data.ai.enabled && Boolean(target)
  const runningOne = Boolean(running)

  const startNew = () => {
    setEditing(NEW)
    setName('')
    setPrompt('')
    setError('')
    setNotice('')
    setMade(null)
  }

  const startEdit = (action: AiAction) => {
    setEditing(action.id)
    setName(action.name)
    setPrompt(action.prompt)
    setError('')
    setNotice('')
  }

  const stopEditing = () => {
    setEditing(null)
    setError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const actionName = name.trim()
    const instruction = prompt.trim()
    if (!actionName || instruction.length < 10) {
      setError('Give the action a name and an instruction of at least 10 characters.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const editingId = editing === NEW ? undefined : editing ?? undefined
      await saveAction({ name: actionName, prompt: instruction }, editingId)
      setEditing(null)
      setNotice(
        editingId ? `Saved “${actionName}”.` : `Added “${actionName}”.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that action.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(action: AiAction) {
    if (
      !window.confirm(
        `Delete the action “${action.name}”? Notes it already made stay in Notes.`,
      )
    )
      return
    setError('')
    setNotice('')
    try {
      await deleteAction(action.id)
      setNotice(`Deleted “${action.name}”.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that action.')
    }
  }

  async function run(action: AiAction) {
    const [kind, id] = target.split(':')
    if (!ready || !id) return
    setRunning(action.id)
    setError('')
    setNotice('')
    setMade(null)
    try {
      const result = await api<{ note: Note; remaining: number }>(
        `/api/actions/${action.id}/run`,
        {
          method: 'POST',
          body: kind === 'note' ? { noteId: id } : { subjectId: id },
        },
      )
      adoptNote(result.note)
      setAiRemaining(result.remaining)
      setMade(result.note)
      setNotice(`“${action.name}” saved a note: ${result.note.title}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action could not finish.')
    } finally {
      setRunning('')
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Your own actions</h3>
        <div className="form-actions">
          <span className="count">
            {data.actions.length
              ? `${data.actions.length} saved`
              : 'None saved yet'}
          </span>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => (editing === NEW ? stopEditing() : startNew())}
          >
            {editing === NEW ? 'Close' : 'New action'}
          </button>
        </div>
      </div>
      <p className="muted">
        Save an instruction once, then run it over one of your notes or a
        subject&rsquo;s whole material. The answer is saved as a note you can
        edit, and each run costs one AI action.
      </p>

      {editing ? (
        <form className="action-form" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              maxLength={60}
              placeholder="Explain it simply"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field grow">
            <span>Instruction</span>
            <textarea
              className="action-prompt"
              value={prompt}
              maxLength={MAX_PROMPT}
              placeholder="Explain this in plain words, as if I missed the class. Finish with three questions I should be able to answer."
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="form-footer">
            <span className="muted">
              {prompt.trim().length.toLocaleString()} /{' '}
              {MAX_PROMPT.toLocaleString()} characters
            </span>
            <div className="form-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={stopEditing}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy
                  ? 'Saving…'
                  : editing === NEW
                    ? 'Save action'
                    : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {error ? <p className="error small">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      {data.actions.length ? (
        <>
          <label className="field action-target">
            <span>Run over</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose a note or a subject</option>
              {data.notes.length ? (
                <optgroup label="One of your notes">
                  {data.notes.map((note) => (
                    <option key={note.id} value={`note:${note.id}`}>
                      {note.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {data.subjects.length ? (
                <optgroup label="All of a subject's material">
                  {data.subjects.map((subject) => (
                    <option key={subject.id} value={`subject:${subject.id}`}>
                      {subject.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          {!data.ai.enabled ? (
            <p className="fineprint">
              Connect a key below and actions start working.
            </p>
          ) : null}
          <ul className="action-list">
            {data.actions.map((action) => (
              <li key={action.id} className="action-item">
                <div className="action-copy">
                  <strong>{action.name}</strong>
                  <span>{action.prompt}</span>
                </div>
                <div className="source-actions">
                  <button
                    type="button"
                    className="btn primary small"
                    disabled={!ready || runningOne}
                    onClick={() => void run(action)}
                  >
                    {running === action.id ? 'Running…' : 'Run'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={runningOne}
                    onClick={() => startEdit(action)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn danger small"
                    disabled={runningOne}
                    onClick={() => void remove(action)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty-line">
          No actions yet. “Explain it simply”, “Make five practice questions” and
          “List the dates I must remember” are good first ones.
        </p>
      )}

      {made ? (
        <div className="ai-answer action-result">
          <div className="card-head">
            <strong>{made.title}</strong>
            <div className="form-actions">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  if (!made) return
                  sessionStorage.setItem('studydeck:note', made.id)
                  onNavigate?.('notes')
                }}
              >
                Open in Notes
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setMade(null)}
              >
                Close
              </button>
            </div>
          </div>
          <Prose text={made.body} />
        </div>
      ) : null}
    </section>
  )
}
