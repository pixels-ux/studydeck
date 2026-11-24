import { useState, type ChangeEvent, type FormEvent } from 'react'
import type {
  Citation,
  LibraryMessage,
  LibrarySearchHit,
  Note,
  Source,
  SourceInput,
} from '../shared/types'
import { api } from './api'
import Prose from './Prose'
import { useWorkspace } from './workspace'

type SearchHit = LibrarySearchHit
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

/** A few words either side of the match, so a note hit reads like the others. */
function snippetOf(text: string, query: string): string {
  const lower = text.toLowerCase()
  const at = lower.indexOf(query.toLowerCase())
  if (at < 0) return text.slice(0, 120)
  const start = Math.max(0, at - 50)
  return `${start ? '…' : ''}${text
    .slice(start, at + query.length + 70)
    .trim()}…`
}

export default function Library({
  onNavigate,
}: {
  onNavigate?: (tab: 'notes') => void
}) {
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
  const [extracting, setExtracting] = useState(false)
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
  const scopeCount = data.sources.filter(
    (source) => scope && source.subjectId === scope,
  ).length

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
  const query = searchQuery.trim()
  const noteHits =
    hits === null || !query
      ? []
      : data.notes
          .filter((note) =>
            `${note.title} ${note.body}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .slice(0, 5)

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setNotice('')
    const name = file.name.toLowerCase()
    const document = /\.(pdf|docx?|txt|md|markdown|csv)$/.test(name)
      ? /\.[^.]+$/.exec(name)![0]
      : ''

    if (document === '.pdf' || document === '.docx' || document === '.doc') {
      setExtracting(true)
      try {
        const response = await fetch(
          `/api/library/extract?name=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
          },
        )
        const payload = (await response.json().catch(() => null)) as {
          text?: string
          characters?: number
          truncated?: boolean
          error?: string
        } | null
        if (!response.ok)
          throw new Error(payload?.error ?? 'That file could not be read.')
        setAdding(true)
        setDraft((current) => ({
          ...current,
          title:
            current.title || file.name.replace(/\.[^.]+$/, '').slice(0, 120),
          origin: file.name.slice(0, 120),
          body: payload?.text ?? '',
        }))
        if (payload?.truncated)
          setNotice(
            `That file holds ${(payload.characters ?? 0).toLocaleString()} characters. The library takes ${MAX_CHARS.toLocaleString()} per item, so split it into chapters. The first part is in the box, ready to edit.`,
          )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That file could not be read.')
      } finally {
        setExtracting(false)
      }
      return
    }

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
      setError('That file could not be read. Choose a PDF, .docx, .txt or .md file.')
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

  /** Revision for a whole subject, not one chapter at a time. */
  async function transformSubject(kind: 'flashcards' | 'slides') {
    if (!scope) return
    setWorking(`subject:${scope}:${kind}`)
    setError('')
    setNotice('')
    try {
      const result = await api<{ note: Note; remaining: number }>(
        '/api/library/transform',
        { method: 'POST', body: { subjectId: scope, kind } },
      )
      adoptNote(result.note)
      setAiRemaining(result.remaining)
      setNotice(
        `Saved “${result.note.title}” in Notes, from all ${scopeName} material.`,
      )
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
            answered from them. Answers name the material they used, Find matches
            on words or on meaning, and one click turns material into revision
            notes or practice questions.
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

          {scope && scopeCount > 0 ? (
            <div className="scope-revision">
              <p className="muted">
                Revise all {scopeCount} {scopeCount === 1 ? 'item' : 'items'} of{' '}
                {scopeName} at once:
              </p>
              <div className="form-actions">
                <button
                  className="btn ghost small"
                  disabled={!data.ai.enabled || Boolean(working)}
                  onClick={() => void transformSubject('flashcards')}
                >
                  {working === `subject:${scope}:flashcards`
                    ? 'Making cards…'
                    : 'Flashcards for the subject'}
                </button>
                <button
                  className="btn ghost small"
                  disabled={!data.ai.enabled || Boolean(working)}
                  onClick={() => void transformSubject('slides')}
                >
                  {working === `subject:${scope}:slides`
                    ? 'Making slides…'
                    : 'Slides for the subject'}
                </button>
              </div>
            </div>
          ) : null}

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
                <span>
                  {extracting
                    ? 'Reading that file…'
                    : 'A file: PDF, Word (.docx), .txt or .md, optional'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.markdown,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                  disabled={extracting}
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
              placeholder="Find a phrase or an idea in your material…"
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
                    <strong>
                      {hit.sourceTitle}
                      {hit.byMeaning ? (
                        <span className="hit-meaning">by meaning</span>
                      ) : null}
                    </strong>
                    <span>{hit.snippet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-line">
                Nothing in your material is close to that.
              </p>
            )
          ) : null}
          {noteHits.length ? (
            <>
              <p className="eyebrow">In your notes</p>
              <ul className="hit-list">
                {noteHits.map((note) => (
                  <li key={note.id} className="hit">
                    <button
                      type="button"
                      className="hit-open"
                      onClick={() => {
                        sessionStorage.setItem('studydeck:note', note.id)
                        onNavigate?.('notes')
                      }}
                    >
                      <strong>{note.title}</strong>
                    </button>
                    <span>{snippetOf(note.body, query)}</span>
                  </li>
                ))}
              </ul>
            </>
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
            or a slide outline is saved into Notes, where you can edit it. Choose a
            subject under <strong>Work from</strong> and the flashcards or slides
            cover all of that subject's material together. Open a flashcard or
            slide note and press <strong>Revise</strong> to work through it.
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
