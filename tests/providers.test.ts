import { afterEach, expect, test } from 'bun:test'
import { askNotes } from '../src/worker/ai'
import type { Env } from '../src/worker/auth'
import { AiError, resolveProvider } from '../src/worker/providers'

const env = (values: Record<string, string>): Env => values as unknown as Env

test('no configuration turns the desk off instead of guessing at a local model', () => {
  expect(resolveProvider(env({}))).toBeNull()
  expect(resolveProvider(env({ AI_PROVIDER: ' ' }))).toBeNull()
})

test('a key alone selects its provider, with that provider’s endpoint and default model', () => {
  const openrouter = resolveProvider(env({ OPENROUTER_API_KEY: 'sk-or' }))!
  expect(openrouter.id).toBe('openrouter')
  expect(openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
  expect(openrouter.model).toBe('openrouter/auto')

  const gemini = resolveProvider(env({ GOOGLE_API_KEY: 'g-key' }))!
  expect(gemini.id).toBe('gemini')
  expect(gemini.baseUrl).toBe(
    'https://generativelanguage.googleapis.com/v1beta/openai',
  )
  expect(gemini.model).toBe('gemini-2.5-flash')

  const freebuff = resolveProvider(env({ OPENAI_API_KEY: 'fb-key' }))!
  expect(freebuff.id).toBe('freebuff')
  expect(freebuff.baseUrl).toBe('https://freebuff.com/api/v1/paid')
  expect(freebuff.model).toBe('deepseek/deepseek-v4-flash')

  // OpenRouter wins when several keys are present.
  const both = resolveProvider(
    env({ OPENROUTER_API_KEY: 'sk-or', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'f' }),
  )!
  expect(both.id).toBe('openrouter')
})

test('AI_PROVIDER overrides detection and never falls back to another service', () => {
  const openai = resolveProvider(
    env({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk', OPENROUTER_API_KEY: 'or' }),
  )!
  expect(openai.id).toBe('openai')
  expect(openai.baseUrl).toBe('https://api.openai.com/v1')
  expect(openai.model).toBe('gpt-4o-mini')

  // Gemini is asked for but has no key: the desk stays off.
  expect(
    resolveProvider(env({ AI_PROVIDER: 'gemini', OPENAI_API_KEY: 'fb' })),
  ).toBeNull()
  expect(resolveProvider(env({ AI_PROVIDER: 'mistral' }))).toBeNull()
})

test('Ollama is local, keyless and only used when pointed at', () => {
  const pointed = resolveProvider(
    env({ OLLAMA_BASE_URL: 'http://localhost:11434/v1' }),
  )!
  expect(pointed.id).toBe('ollama')
  expect(pointed.baseUrl).toBe('http://localhost:11434/v1')

  const ollama = resolveProvider(env({ AI_PROVIDER: 'ollama' }))!
  expect(ollama.id).toBe('ollama')
  expect(ollama.baseUrl).toBe('http://127.0.0.1:11434/v1')
  expect(ollama.model).toBe('llama3.2')
  expect(ollama.apiKey).toBeUndefined()

  const named = resolveProvider(env({ OLLAMA_MODEL: 'qwen2.5:7b' }))!
  expect(named.id).toBe('ollama')
  expect(named.model).toBe('qwen2.5:7b')

  const remote = resolveProvider(
    env({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://gpu-box:11434/v1/' }),
  )!
  expect(remote.baseUrl).toBe('http://gpu-box:11434/v1')
})

test('AI_MODEL and AI_BASE_URL apply where the service allows them', () => {
  expect(
    resolveProvider(
      env({ OPENROUTER_API_KEY: 'k', AI_MODEL: 'anthropic/claude-sonnet-4' }),
    )!.model,
  ).toBe('anthropic/claude-sonnet-4')

  expect(
    resolveProvider(env({ OPENROUTER_API_KEY: 'k', AI_MODEL: 'bad model!' }))!.model,
  ).toBe('openrouter/auto')

  // Freebuff keeps its allowlist even when AI_MODEL names something else.
  expect(
    resolveProvider(
      env({ OPENAI_API_KEY: 'k', AI_MODEL: 'openai/gpt-6-luna' }),
    )!.model,
  ).toBe('openai/gpt-6-luna')
  expect(
    resolveProvider(
      env({ OPENAI_API_KEY: 'k', AI_MODEL: 'not/allowed' }),
    )!.model,
  ).toBe('deepseek/deepseek-v4-flash')

  expect(
    resolveProvider(
      env({ OPENROUTER_API_KEY: 'k', AI_BASE_URL: 'https://proxy.internal/v1/' }),
    )!.baseUrl,
  ).toBe('https://proxy.internal/v1')
})

type Sent = { url: string; headers: Headers; body: Record<string, unknown> }

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(reply: { status?: number; content?: string } = {}): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    const status = reply.status ?? 200
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply.content ?? 'An answer.' } }],
      }),
      { status },
    )
  }) as typeof fetch
  return sent
}

const notes = [{ title: 'Photosynthesis', body: 'Light reactions happen first.' }]

test('a keyless Ollama request sends no Authorization header', async () => {
  const sent = stubFetch()
  const answer = await askNotes(
    env({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'llama3.2' }),
    'What happens first?',
    notes,
  )
  expect(answer).toBe('An answer.')
  expect(sent).toHaveLength(1)
  expect(sent[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions')
  expect(sent[0]!.headers.get('Authorization')).toBeNull()
  expect(sent[0]!.body.model).toBe('llama3.2')
  expect(JSON.stringify(sent[0]!.body.messages)).toContain('Photosynthesis')
})

test('hosted providers send their key and any extra header', async () => {
  const sent = stubFetch()
  await askNotes(env({ OPENROUTER_API_KEY: 'sk-or-123' }), 'Why?', notes)
  expect(sent[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect(sent[0]!.headers.get('Authorization')).toBe('Bearer sk-or-123')
  expect(sent[0]!.headers.get('X-Title')).toBe('Studydeck')
})

test('provider failures become messages the desk may show', async () => {
  stubFetch({ status: 401 })
  const refused = askNotes(env({ GEMINI_API_KEY: 'bad' }), 'Why?', notes)
  await expect(refused).rejects.toBeInstanceOf(AiError)
  await expect(
    askNotes(env({ GEMINI_API_KEY: 'bad' }), 'Why?', notes),
  ).rejects.toThrow('refused the API key')

  stubFetch({ status: 404 })
  await expect(
    askNotes(env({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'ghost' }), 'Why?', notes),
  ).rejects.toThrow('ollama pull ghost')

  globalThis.fetch = (async () => {
    throw new TypeError('connection refused')
  }) as unknown as typeof fetch
  await expect(
    askNotes(env({ AI_PROVIDER: 'ollama' }), 'Why?', notes),
  ).rejects.toThrow('Could not reach Ollama at http://127.0.0.1:11434/v1')
})
