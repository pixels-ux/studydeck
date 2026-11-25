import { useEffect, useState, type FormEvent } from 'react'
import { api } from './api'
import { useWorkspace } from './workspace'

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

/** A hint like "openrouter.ai/keys" becomes the link to the key page. */
function hintLink(hint: string): string {
  return /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(hint) ? `https://${hint}` : ''
}

/** The student's own key: saved on the server, never sent back to the browser. */
export default function ApiKeys() {
  const { data, refresh } = useWorkspace()
  const [settings, setSettings] = useState<KeySettings | null>(null)
  const [provider, setProvider] = useState('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const loaded = await api<KeySettings>('/api/ai/settings')
      setSettings(loaded)
      if (loaded.saved) {
        setProvider(loaded.saved.provider)
        setModel(loaded.saved.model)
        setBaseUrl(loaded.saved.baseUrl)
      }
    } catch {
      setSettings(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const info = settings?.providers.find((item) => item.id === provider)
  const needsUrl = provider === 'custom' || provider === 'ollama'
  const keyRequired = info ? info.needsKey : true
  const savedHere = settings?.saved?.provider === provider

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api<{ ok: boolean }>('/api/ai/settings', {
        method: 'PUT',
        body: { provider, apiKey: apiKey.trim() || undefined, model, baseUrl },
      })
      setApiKey('')
      await refresh()
      await load()
      setNotice(
        `${info?.label ?? 'That service'} is connected. The study desk uses this key for your questions only.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that key.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api<{ ok: boolean }>('/api/ai/settings', { method: 'DELETE' })
      setApiKey('')
      await refresh()
      await load()
      setNotice('The saved key was removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>API keys</h3>
        <span className="count">
          {settings?.source === 'account'
            ? `Saved ${settings.saved?.hint ?? ''}`.trim()
            : settings?.source === 'server'
              ? 'Using the server key'
              : 'Not connected'}
        </span>
      </div>
      <p className="muted">
        Add a key from any supported service and the study desk, saved actions
        and library answers use it for your requests only. It stays on this
        server, is never shown again in the browser, and you can remove it
        whenever you like.
        {data.ai.enabled
          ? ` ${data.ai.remaining} of ${data.ai.limit} AI actions are left today.`
          : ' Everything else in Studydeck works without a key.'}
      </p>
      <form onSubmit={(event) => void save(event)}>
        <div className="key-form">
          <label className="field">
            <span>Service</span>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value)
                setNotice('')
                setError('')
              }}
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
                placeholder={
                  savedHere
                    ? `Saved ${settings?.saved?.hint ?? ''} — leave empty to keep it`
                    : info?.hint
                      ? `from ${info.hint}`
                      : 'Paste your key'
                }
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
            disabled={
              busy || (keyRequired && !apiKey.trim() && !settings?.saved)
            }
          >
            {busy ? 'Saving…' : settings?.saved ? 'Save changes' : 'Save key'}
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
        {notice ? <p className="fineprint">{notice}</p> : null}
      </form>

      <details className="key-help">
        <summary>Where to get a key</summary>
        <ul>
          {(settings?.providers ?? [])
            .filter((item) => item.needsKey)
            .map((item) => {
              const link = hintLink(item.hint)
              return (
                <li key={item.id}>
                  <span className="key-help-name">{item.label}</span>
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer">
                      {item.hint}
                    </a>
                  ) : (
                    <span className="key-help-model">{item.hint}</span>
                  )}
                </li>
              )
            })}
        </ul>
      </details>

      <p className="fineprint">
        Keys are kept in this deployment&rsquo;s database, so use a key you can
        rotate. Your key is only used for your own requests and is limited to
        the same daily allowance as everyone else.
      </p>
    </section>
  )
}
