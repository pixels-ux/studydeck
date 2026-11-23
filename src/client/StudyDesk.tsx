import { useEffect, useState, type FormEvent } from 'react'
import { api } from './api'
import { fmtDate, todayISO } from './dates'
import Prose from './Prose'
import { useWorkspace } from './workspace'

type Turn = { id: string; question: string; answer?: string; error?: string }

type ProviderInfo = {
  id: string
  label: string
  needsKey: boolean
  defaultModel: string
  hint: string
}

type KeySettings = {
  source: 'account' | 'server' | null
  provider: { id: string; label: string; model: string } | null
  saved: {
    provider: string
    model: string
    baseUrl: string
    hint: string
    updatedAt: number
  } | null
  providers: ProviderInfo[]
}

/** A student's own key: saved on the server, never sent back to the browser. */
function KeyCard() {
  const [settings, setSettings] = useState<KeySettings | null>(null)
  const [provider, setProvider] = useState('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<KeySettings>('/api/ai/settings')
      .then((loaded) => {
        setSettings(loaded)
        if (loaded.saved) {
          setProvider(loaded.saved.provider)
          setModel(loaded.saved.model)
          setBaseUrl(loaded.saved.baseUrl)
        }
      })
      .catch(() => setSettings(null))
  }, [])

  const info = settings?.providers.find((item) => item.id === provider)
  const needsUrl = provider === 'custom' || provider === 'ollama'
  const keyRequired = info ? info.needsKey : true

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api<{ ok: boolean }>('/api/ai/settings', {
        method: 'PUT',
        body: { provider, apiKey: apiKey || undefined, model, baseUrl },
      })
      // The provider is read on every page, so reload once it is saved.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that key.')
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await api<{ ok: boolean }>('/api/ai/settings', { method: 'DELETE' })
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that key.')
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Your own API key</h3>
        <span className="count">
          {settings?.source === 'account'
            ? `Saved ${settings.saved?.hint ?? ''}`.trim()
            : settings?.source === 'server'
              ? 'Using the server key'
              : 'Not connected'}
        </span>
      </div>
      <p className="muted">
        Add a key from any supported service and the study desk uses it for your
        questions only. It stays on this server, is never shown again in the
        browser, and you can remove it whenever you like.
      </p>
      <form onSubmit={(event) => void save(event)}>
        <div className="key-form">
          <label className="field">
            <span>Service</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {(settings?.providers ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {keyRequired ? (
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                maxLength={400}
                placeholder={info?.hint ? `from ${info.hint}` : 'Paste your key'}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          ) : null}
          {needsUrl ? (
            <label className="field">
              <span>Base URL{provider === 'ollama' ? ' (optional)' : ''}</span>
              <input
                value={baseUrl}
                maxLength={200}
                placeholder={
                  provider === 'ollama'
                    ? 'http://127.0.0.1:11434/v1'
                    : 'https://your-service/v1'
                }
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>Model (optional)</span>
            <input
              value={model}
              maxLength={80}
              placeholder={info?.defaultModel || 'Service default'}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="btn primary"
            disabled={busy || (keyRequired && !apiKey.trim())}
          >
            {busy ? 'Saving…' : 'Save key'}
          </button>
          {settings?.saved ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove saved key
            </button>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <p className="fineprint">
        Keys are kept in this deployment&rsquo;s database, so use a key you can
        rotate. Your key is only used for your own questions and is limited to
        the same daily allowance as everyone else.
      </p>
    </section>
  )
}

export default function StudyDesk() {
  const { data, saveNote, setAiRemaining } = useWorkspace()
  const [scope, setScope] = useState('')
  const [summary, setSummary] = useState<{ text: string; scope: string } | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [error, setError] = useState('')

  const scopeName = data.subjects.find((subject) => subject.id === scope)?.name ?? 'all subjects'
  const ready = data.ai.enabled && data.notes.length > 0

  async function summarise() {
    setSummaryBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await api<{ answer: string; remaining: number }>(
        '/api/ai/summarize',
        { method: 'POST', body: { subjectId: scope || null } },
      )
      setSummary({ text: result.answer, scope: scopeName })
      setAiRemaining(result.remaining)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not summarise your notes.')
    } finally {
      setSummaryBusy(false)
    }
  }

  async function ask() {
    const text = question.trim()
    if (!text || askBusy) return
    const id = crypto.randomUUID()
    setTurns((current) => [...current, { id, question: text }])
    setQuestion('')
    setAskBusy(true)
    setError('')
    try {
      const result = await api<{ answer: string; remaining: number }>('/api/ai/ask', {
        method: 'POST',
        body: { question: text, subjectId: scope || null },
      })
      setAiRemaining(result.remaining)
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, answer: result.answer } : turn)),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The assistant could not answer.'
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, error: message } : turn)),
      )
    } finally {
      setAskBusy(false)
    }
  }

  async function keepSummary() {
    if (!summary) return
    try {
      await saveNote({
        subjectId: scope || null,
        title: `Summary · ${summary.scope} · ${fmtDate(todayISO())}`,
        body: summary.text,
      })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the summary.')
    }
  }

  return (
    <div className="stack">
      <section className="card desk-intro">
        <div>
          <div className="card-head">
            <h3>Your notes, made useful</h3>
            <span className="count">
              {data.ai.enabled
                ? `${data.ai.remaining} of ${data.ai.limit} actions left today`
                : 'Not connected'}
            </span>
          </div>
          <p className="muted">
            The study desk answers from your notes, using your CBSE class and
            NCERT chapter outline to keep to your syllabus. It names the note it
            used, and a summary can be saved straight back into your notebook.
          </p>
          {data.ai.enabled ? (
            <p className="fineprint">
              Answers come from {data.ai.provider}
              {data.ai.model ? ` (${data.ai.model})` : ''}.
            </p>
          ) : null}
        </div>
        <label className="field">
          <span>Work from</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">All subjects</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!data.ai.enabled ? (
        <section className="card ai-setup">
          <h3>The AI study desk is not connected yet</h3>
          <p className="muted">
            Everything else in Studydeck works without it. Paste a key in{' '}
            <strong>Your own API key</strong> below and it works immediately, or
            set one on the server:
          </p>
          <ul className="setup-steps">
            <li>
              <code>OPENROUTER_API_KEY</code> from openrouter.ai/keys.
            </li>
            <li>
              <code>GEMINI_API_KEY</code> from aistudio.google.com/apikey.
            </li>
            <li>
              <code>OPENAI_API_KEY</code> for the hosted default (Freebuff), or
              add <code>AI_PROVIDER=openai</code> for OpenAI itself.
            </li>
            <li>
              Running the server yourself? <code>AI_PROVIDER=ollama</code> uses
              a local Ollama and needs no key at all.
            </li>
          </ul>
          <p className="fineprint">
            The key stays on the server and is never sent to your browser. Each
            account is limited to {data.ai.limit} AI actions a day.
          </p>
        </section>
      ) : null}

      {data.ai.enabled && data.notes.length === 0 ? (
        <section className="card">
          <p className="empty-line">
            Write a note first. The study desk only answers from your own notes.
          </p>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>Summarise into revision points</h3>
          <button
            className="btn primary"
            disabled={!ready || summaryBusy}
            onClick={() => void summarise()}
          >
            {summaryBusy ? 'Reading your notes…' : `Summarise ${scopeName}`}
          </button>
        </div>
        {summary ? (
          <div className="ai-answer">
            <Prose text={summary.text} />
            <div className="form-actions">
              <button
                className="btn ghost small"
                disabled={saved}
                onClick={() => void keepSummary()}
              >
                {saved ? 'Saved to notes' : 'Save as a note'}
              </button>
              <button className="btn ghost small" onClick={() => setSummary(null)}>
                Clear
              </button>
            </div>
          </div>
        ) : (
          <p className="empty-line">
            An overview of {scopeName}: the key points and the terms worth memorising.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Ask your notes</h3>
          <span className="count">{turns.length} question{turns.length === 1 ? '' : 's'}</span>
        </div>
        {turns.length === 0 ? (
          <p className="empty-line">
            Try “What are the causes I wrote down?” or “Explain the light
            reactions simply.”
          </p>
        ) : (
          <ol className="chat">
            {turns.map((turn) => (
              <li key={turn.id} className="chat-turn">
                <p className="chat-question">{turn.question}</p>
                {turn.answer ? (
                  <div className="chat-answer">
                    <Prose text={turn.answer} />
                  </div>
                ) : turn.error ? (
                  <p className="error small">{turn.error}</p>
                ) : (
                  <p className="muted small">Reading your notes…</p>
                )}
              </li>
            ))}
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
            placeholder="Ask something your notes should answer…"
            aria-label="Ask your notes"
            onChange={(event) => setQuestion(event.target.value)}
            disabled={!ready || askBusy}
          />
          <button className="btn primary" disabled={!ready || askBusy || !question.trim()}>
            {askBusy ? 'Thinking…' : 'Ask'}
          </button>
        </form>
        <p className="fineprint">
          Answers cite the notes they came from, like [Photosynthesis]. If
          something is missing, the assistant says so instead of guessing.
        </p>
      </section>

      <KeyCard />
    </div>
  )
}
