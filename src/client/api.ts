export type ApiInit = { method?: string; body?: unknown }

const STORE_KEY = 'studydeck:notebook'

/** The notebook every request speaks for; the server falls back if unknown. */
let current = readStored()

function readStored(): string {
  try {
    return window.localStorage.getItem(STORE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Remembers which book is open, both for this visit and the next one. */
export function rememberNotebook(id: string): void {
  current = id
  try {
    window.localStorage.setItem(STORE_KEY, id)
  } catch {
    // Storage can be turned off; the visit still works from memory.
  }
}

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(current ? { 'X-Notebook': current } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'The request failed. Please try again.'
    throw new Error(message)
  }
  return payload as T
}
