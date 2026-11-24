import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { Citation, LibraryMessage, Note, Source, SourceInput } from '../shared/types'
import { api } from './api'
import Prose from './Prose'
import { useWorkspace } from './workspace'

type SearchHit = { sourceId: string; sourceTitle: string; snippet: string }
type AskResult = {
  student: LibraryMessage
  reply: LibraryMessage
  remaining: number
}

const MAX_CHARS = 20_000
const emptyDraft: SourceInput = {
  subjectId: null,
  title: '',
  origin: 'Pasted',
  body: '',
}

/** One chip per material item, numbered as the answer cited it. */
function Citations({ citations }: { citations: Citation[] }) {
  const seen = new Map<string, Citation>()
  for (const citation of citations)
    if (!seen.has(citation.sourceId)) seen.set(citation.sourceId, citation)
  if (!seen.size) return null
  return (
    <div className="citations">
      {[...seen.values()].map((citation) => (
        <span key={citation.sourceId} className="citation">
          [{citation.index}] {citation.sourceTitle}
        </span>
      ))}
    </div>
  )
}

export default function Library() {
  const {
    data,
    saveSource,
    deleteSource,
    adoptNote,
    appendLibrary,
    clearLibrary,
    setAiRemaining,
  } = useWorkspace()

  const [scope, setScope] = useState('')
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<SourceInput>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [pending, setPending] = useState('')
  const [working, setWorking] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  const scopeId = scope || null
  const subjectName = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.name ?? 'General'
  const subjectColor = (id: string | null) =>
    data.subjects.find((subject) => subject.id === id)?.color ?? '#7b857d'
  const scopeName =
    data.subjects.find((subject) => subject.id === scopeId)?.name ??
    'all your material'

  const sources = data.sources.filter((source) => {
    if (scope && source.subjectId !== scope) return false
    if (!filter.trim()) return true
    return `${source.title} ${source.body}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase())
  })
  const messages = data.library.filter(
    (message) => message.subjectId === scopeId,
  )
  const materialHere = data.sources.some(
    (source) => !scope || source.subjectId === scope,
  )
  const ready = data.ai.enabled && materialHere

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      const text = await file.text()
      if (text.length > MAX_CHARS) {
        setError(
          `That file is ${text.length.toLocaleString()} characters. The library takes ${MAX_CHARS.toLocaleString()} per item, so split it into chapters.`,
        )
        return
      }
      setAdding(true)
      setDraft((current) => ({
        ...current,
        title: current.title || file.name.replace(/\.[^.]+$/, '').slice(0, 120),
        origin: file.name.slice(0, 120),
        body: text,
      }))
    } catch {
      setError('That file could not be read. Choose a .txt or .md file.')
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!draft.body.trim()) {
      setError('Paste some text or choose a file first.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveSource({
        ...draft,
        subjectId: draft.subjectId,
        title: draft.title.trim() || draft.body.split('\n')[0]!.slice(0, 80),
      })
      setDraft({ ...emptyDraft, subjectId: scopeId })
      setAdding(false)
      setNotice('Added to your material.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that material.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(source: Source) {
    if (!window.confirm(`Remove “${source.title}” from your material?`)) return
    setError('')
    try {
      await deleteSource(source.id)
      setHits(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that material.')
    }
  }

  async function ask() {
    const text = question.trim()
    if (!text || asking) return
    setAsking(true)
    setError('')
    setNotice('')
    setPending(text)
    setQuestion('')
    try {
      const result = await api<AskResult>('/api/library/ask', {
        method: 'POST',
        body: { question: text, subjectId: scopeId },
      })
      appendLibrary([result.student, result.reply])
      setAiRemaining(result.remaining)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not answer.')
      setQuestion(text)
    } finally {
      setPending('')
      setAsking(false)
    }
  }

  async function transform(
    source: Source,
    kind: 'summary' | 'questions' | 'flashcards' | 'slides',
  ) {
    setWorking(`${source.id}:${kind}`)
    setError('')
    setNotice('')
    try {
      const result = await api<{ note: Note; remaining: number }>(
        '/api/library/transform',
        { method: 'POST', body: { sourceId: source.id, kind } },
      )
      adoptNote(result.note)
      setAiRemaining(result.remaining)
      setNotice(`Saved “${result.note.title}” in Notes.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make that note.')
    } finally {
      setWorking('')
    }
  }

  async function find(event: FormEvent) {
    event.preventDefault()
    const text = searchQuery.trim()
    if (!text) {
      setHits(null)
      return
    }
    setSearching(true)
    setError('')
    try {
      const query = new URLSearchParams({ q: text })
      if (scopeId) query.set('subjectId', scopeId)
      const result = await api<{ results: SearchHit[] }>(
        `/api/library/search?${query}`,
      )
      setHits(result.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not search your material.')
    } finally {
      setSearching(false)
    }
  }

  async function startOver() {
    if (!window.confirm('Clear this conversation? Your material stays.')) return
    setError('')
    try {
      await clearLibrary(scopeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear that.')
    }
  }

  return (
    <div className="stack">
      <section className="card desk-intro">
        <div>
          <div className="card-head">
            <h3>A notebook of your material</h3>
            <span className="count">
              {data.ai.enabled
                ? `${data.ai.remaining} of ${data.ai.limit} actions left today`
                : 'AI not connected'}
            </span>
          </div>
          <p className="muted">
            Add chapters, articles or your own notes, then ask questions that are
            answered from them. Answers name the material they used, search finds
            a phrase across everything, and one click turns material into
            revision notes or practice questions.
          </p>
        </div>
        <label className="field">
          <span>Work from</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">All your material</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="library-layout">
        <section className="card">
          <div className="card-head">
            <h3>Material</h3>
            <button
              className="btn primary small"
              onClick={() => {
                setError('')
                setAdding(!adding)
                if (!adding)
                  setDraft({ ...emptyDraft, subjectId: scopeId })
              }}
            >
              {adding ? 'Close' : 'Add material'}
            </button>
          </div>

          {adding ? (
            <form className="source-form" onSubmit={(event) => void add(event)}>
              <label className="field">
                <span>Title</span>
                <input
                  value={draft.title}
                  maxLength={120}
                  placeholder="Chapter 6 · Life processes"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
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
              <label className="field">
                <span>Text file (.txt or .md), optional</span>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.csv,text/plain,text/markdown"
                  onChange={(event) => void pickFile(event)}
                />
              </label>
              <label className="field">
                <span>Material</span>
                <textarea
                  className="source-body"
                  value={draft.body}
                  maxLength={MAX_CHARS}
                  placeholder="Paste the chapter, the article or your class notes here."
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      body: event.target.value,
                      origin:
                        current.origin === 'Pasted' ? 'Pasted' : current.origin,
                    }))
                  }
                />
              </label>
              <div className="form-footer">
                <span className="muted">
                  {draft.body.length.toLocaleString()} /{' '}
                  {MAX_CHARS.toLocaleString()} characters
                </span>
                <div className="form-actions">
                  <button className="btn primary" disabled={saving}>
                    {saving ? 'Adding…' : 'Add to library'}
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          <form className="ask-form" onSubmit={(event) => void find(event)}>
            <input
              value={searchQuery}
              maxLength={200}
              placeholder="Find a phrase in your material…"
              aria-label="Search your material"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button
              className="btn ghost"
              disabled={searching || !searchQuery.trim()}
            >
              {searching ? 'Searching…' : 'Find'}
            </button>
          </form>
          {hits ? (
            hits.length ? (
              <ul className="hit-list">
                {hits.map((hit) => (
                  <li key={hit.sourceId} className="hit">
                    <strong>{hit.sourceTitle}</strong>
                    <span>{hit.snippet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-line">No material contains that phrase.</p>
            )
          ) : null}

          <input
            className="search"
            value={filter}
            placeholder="Filter by title or text…"
            aria-label="Filter your material"
            onChange={(event) => setFilter(event.target.value)}
          />
          {sources.length === 0 ? (
            <p className="empty-line">
              {data.sources.length
                ? 'Nothing here matches that filter.'
                : 'No material yet. Add a chapter to start.'}
            </p>
          ) : (
            <ul className="source-list">
              {sources.map((source) => (
                <li key={source.id} className="source-item">
                  <div className="source-head">
                    <span
                      className="dot"
                      style={{ background: subjectColor(source.subjectId) }}
                    />
                    <strong>{source.title}</strong>
                    <span className="count">
                      {subjectName(source.subjectId)}
                    </span>
                  </div>
                  <p className="source-preview">{source.body.slice(0, 140)}</p>
                  <div className="source-actions">
                    <button
                      className="btn ghost small"
                      disabled={!data.ai.enabled || Boolean(working)}
                      onClick={() => void transform(source, 'summary')}
                    >
                      {working === `${source.id}:summary`
                        ? 'Summarising…'
                        : 'Summarise'}
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={!data.ai.enabled || Boolean(working)}
                      onClick={() => void transform(source, 'questions')}
                    >
                      {working === `${source.id}:questions`
                        ? 'Writing…'
                        : 'Practice questions'}
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={!data.ai.enabled || Boolean(working)}
                      onClick={() => void transform(source, 'flashcards')}
                    >
                      {working === `${source.id}:flashcards`
                        ? 'Making cards…'
                        : 'Flashcards'}
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={!data.ai.enabled || Boolean(working)}
                      onClick={() => void transform(source, 'slides')}
                    >
                      {working === `${source.id}:slides` ? 'Making slides…' : 'Slides'}
                    </button>
                    <button
                      className="btn danger small"
                      onClick={() => void remove(source)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="fineprint">
            Material is cut into paragraphs and matched by keyword, so nothing is
            sent anywhere to be indexed. A summary, practice questions, flashcards
            or a slide outline is saved into Notes, where you can edit it. Open a
            flashcard or slide note and press <strong>Revise</strong> to work
            through it.
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Ask your material</h3>
            <span className="count">
              {messages.length
                ? `${Math.ceil(messages.length / 2)} question${messages.length > 2 ? 's' : ''}`
                : 'New conversation'}
            </span>
            {messages.length ? (
              <button
                className="btn ghost small"
                onClick={() => void startOver()}
              >
                Start over
              </button>
            ) : null}
          </div>

          {!data.ai.enabled ? (
            <p className="muted">
              Connect a key in the AI study desk tab and questions start working.
              Adding, searching and reading material works without one.
            </p>
          ) : null}

          {messages.length === 0 && !pending ? (
            <p className="empty-line">
              {materialHere
                ? `Ask something ${scopeName} should answer, like “Explain the light reactions simply.”`
                : 'Add material first. Answers come from what you add.'}
            </p>
          ) : (
            <ol className="chat">
              {messages.map((message) => (
                <li key={message.id} className="chat-turn">
                  {message.role === 'student' ? (
                    <p className="chat-question">{message.body}</p>
                  ) : (
                    <div className="chat-answer">
                      <Prose text={message.body} />
                      <Citations citations={message.citations} />
                    </div>
                  )}
                </li>
              ))}
              {pending ? (
                <li className="chat-turn">
                  <p className="chat-question">{pending}</p>
                  <p className="muted small">Reading {scopeName}…</p>
                </li>
              ) : null}
            </ol>
          )}

          <form
            className="ask-form"
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            <input
              value={question}
              maxLength={500}
              placeholder="Ask something your material should answer…"
              aria-label="Ask your material"
              onChange={(event) => setQuestion(event.target.value)}
              disabled={!ready || asking}
            />
            <button
              className="btn primary"
              disabled={!ready || asking || !question.trim()}
            >
              {asking ? 'Thinking…' : 'Ask'}
            </button>
          </form>
          <p className="fineprint">
            The answer sees only the paragraphs that match your question, and
            cites them like [1]. If the material does not cover it, it says so
            instead of answering from memory.
          </p>
        </section>
      </div>
    </div>
  )
}
