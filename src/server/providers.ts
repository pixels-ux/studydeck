import type { Env } from './env'

export type ProviderId =
  | 'freebuff'
  | 'openrouter'
  | 'gemini'
  | 'openai'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'together'
  | 'custom'
  | 'ollama'

export type Provider = {
  id: ProviderId
  /** Shown in the study desk, so the owner can see which service answers. */
  label: string
  /** OpenAI-compatible base URL, without a trailing slash or `/chat/completions`. */
  baseUrl: string
  /** Sent as a bearer token. Ollama needs none. */
  apiKey?: string
  model: string
  /** Extra headers a service asks for. */
  headers: Record<string, string>
}

/** Freebuff's hosted models. The browser still never chooses one of these. */
export const FREEBUFF_MODELS = [
  'deepseek/deepseek-v4-flash',
  'mimo/mimo-v2.5',
  'z-ai/glm-5.3-flash',
  'openai/gpt-6-luna',
] as const

export const PROVIDER_IDS: ProviderId[] = [
  'freebuff',
  'openrouter',
  'gemini',
  'openai',
  'groq',
  'mistral',
  'deepseek',
  'together',
  'custom',
  'ollama',
]

/** Model names are passed straight to the service, so keep them plain. */
const MODEL_PATTERN = /^[A-Za-z0-9._:-][A-Za-z0-9._:/-]{0,79}$/

const trim = (url: string) => url.replace(/\/+$/, '')

/** A failure the study desk may show the student as-is. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

/** `AI_MODEL` for services where any hosted or installed model is valid. */
function freeModel(env: Env, fallback: string): string {
  const configured = (env.AI_MODEL ?? '').trim()
  return MODEL_PATTERN.test(configured) ? configured : fallback
}

function freebuff(env: Env): Provider | null {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) return null
  const configured = (env.AI_MODEL ?? '').trim()
  return {
    id: 'freebuff',
    label: 'Freebuff',
    baseUrl: trim(
      env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://freebuff.com/api/v1/paid',
    ),
    apiKey,
    model: (FREEBUFF_MODELS as readonly string[]).includes(configured)
      ? configured
      : FREEBUFF_MODELS[0]!,
    headers: {},
  }
}

function openrouter(env: Env): Provider | null {
  if (!env.OPENROUTER_API_KEY) return null
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: trim(env.AI_BASE_URL || 'https://openrouter.ai/api/v1'),
    apiKey: env.OPENROUTER_API_KEY,
    // `openrouter/auto` picks a model per request, so a fresh key works
    // without the owner naming a model that may have been retired.
    model: freeModel(env, 'openrouter/auto'),
    headers: { 'X-Title': 'Studydeck' },
  }
}

function gemini(env: Env): Provider | null {
  // Google's OpenAI-compatible endpoint keeps one request shape for every
  // provider; GOOGLE_API_KEY is the older name for the same key.
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY
  if (!apiKey) return null
  return {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: trim(
      env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    ),
    apiKey,
    model: freeModel(env, 'gemini-2.5-flash'),
    headers: {},
  }
}

function openai(env: Env): Provider | null {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) return null
  return {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: trim(
      env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    ),
    apiKey,
    model: freeModel(env, 'gpt-4o-mini'),
    headers: {},
  }
}

function ollama(env: Env): Provider | null {
  // Ollama runs next to the server and needs no key, so it is only ever
  // selected deliberately: by AI_PROVIDER=ollama or by pointing at it.
  const configured = (env.AI_MODEL ?? '').trim() || (env.OLLAMA_MODEL ?? '').trim()
  return {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: trim(
      env.AI_BASE_URL || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    ),
    model: MODEL_PATTERN.test(configured) ? configured : 'llama3.2',
    headers: {},
  }
}

function groq(env: Env): Provider | null {
  if (!env.GROQ_API_KEY) return null
  return {
    id: 'groq',
    label: 'Groq',
    baseUrl: trim(env.AI_BASE_URL || 'https://api.groq.com/openai/v1'),
    apiKey: env.GROQ_API_KEY,
    model: freeModel(env, 'llama-3.3-70b-versatile'),
    headers: {},
  }
}

function mistral(env: Env): Provider | null {
  if (!env.MISTRAL_API_KEY) return null
  return {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: trim(env.AI_BASE_URL || 'https://api.mistral.ai/v1'),
    apiKey: env.MISTRAL_API_KEY,
    model: freeModel(env, 'mistral-small-latest'),
    headers: {},
  }
}

function deepseek(env: Env): Provider | null {
  if (!env.DEEPSEEK_API_KEY) return null
  return {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: trim(env.AI_BASE_URL || 'https://api.deepseek.com/v1'),
    apiKey: env.DEEPSEEK_API_KEY,
    model: freeModel(env, 'deepseek-chat'),
    headers: {},
  }
}

function together(env: Env): Provider | null {
  if (!env.TOGETHER_API_KEY) return null
  return {
    id: 'together',
    label: 'Together',
    baseUrl: trim(env.AI_BASE_URL || 'https://api.together.xyz/v1'),
    apiKey: env.TOGETHER_API_KEY,
    model: freeModel(env, 'meta-llama/Llama-3.3-70B-Instruct-Turbo'),
    headers: {},
  }
}

/** Any other OpenAI-compatible service: a URL, a model, and usually a key. */
function custom(env: Env): Provider | null {
  const baseUrl = (env.AI_BASE_URL ?? '').trim()
  const model = (env.AI_MODEL ?? '').trim()
  if (!/^https?:\/\//.test(baseUrl) || !MODEL_PATTERN.test(model)) return null
  return {
    id: 'custom',
    label: 'Your AI service',
    baseUrl: trim(baseUrl),
    apiKey: env.AI_API_KEY || undefined,
    model,
    headers: {},
  }
}

/** The services the in-app key form offers, in the order it shows them. */
export const PROVIDERS: {
  id: ProviderId
  label: string
  needsKey: boolean
  defaultModel: string
  hint: string
}[] = [
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, defaultModel: 'openrouter/auto', hint: 'openrouter.ai/keys' },
  { id: 'gemini', label: 'Google Gemini', needsKey: true, defaultModel: 'gemini-2.5-flash', hint: 'aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', needsKey: true, defaultModel: 'llama-3.3-70b-versatile', hint: 'console.groq.com/keys' },
  { id: 'openai', label: 'OpenAI', needsKey: true, defaultModel: 'gpt-4o-mini', hint: 'platform.openai.com/api-keys' },
  { id: 'mistral', label: 'Mistral', needsKey: true, defaultModel: 'mistral-small-latest', hint: 'console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', needsKey: true, defaultModel: 'deepseek-chat', hint: 'platform.deepseek.com/api_keys' },
  { id: 'together', label: 'Together', needsKey: true, defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', hint: 'api.together.ai/settings/api-keys' },
  { id: 'freebuff', label: 'Freebuff', needsKey: true, defaultModel: FREEBUFF_MODELS[0], hint: 'freebuff.com/account/api' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', needsKey: false, defaultModel: '', hint: 'needs a base URL and a model' },
  { id: 'ollama', label: 'Ollama on this server', needsKey: false, defaultModel: 'llama3.2', hint: 'no key needed' },
]

/** Which variable a saved key would have come from in the environment. */
const KEY_VARS: Record<ProviderId, string> = {
  freebuff: 'OPENAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  together: 'TOGETHER_API_KEY',
  custom: 'AI_API_KEY',
  ollama: '',
}

export type SavedSettings = {
  provider: ProviderId
  apiKey?: string
  model?: string
  baseUrl?: string
}

/** A provider built from the settings a student saved in the app. */
export function providerFromSettings(settings: SavedSettings): Provider | null {
  const env = {
    AI_PROVIDER: settings.provider,
    AI_MODEL: settings.model ?? '',
    AI_BASE_URL: settings.baseUrl ?? '',
  } as Env
  const keyVar = KEY_VARS[settings.provider]
  if (keyVar && settings.apiKey)
    (env as unknown as Record<string, string>)[keyVar] = settings.apiKey
  return BUILDERS[settings.provider](env)
}

const BUILDERS: Record<ProviderId, (env: Env) => Provider | null> = {
  freebuff,
  openrouter,
  gemini,
  openai,
  groq,
  mistral,
  deepseek,
  together,
  custom,
  ollama,
}

/** With no AI_PROVIDER, the first configured key wins. */
const AUTO_ORDER: ProviderId[] = [
  'openrouter',
  'groq',
  'gemini',
  'deepseek',
  'mistral',
  'together',
  'freebuff',
]

/**
 * The service the study desk talks to, or null when nothing is configured.
 * `AI_PROVIDER` always wins over detection, and an unknown or keyless choice
 * turns the desk off instead of silently using a different service.
 */
export function resolveProvider(env: Env): Provider | null {
  const requested = (env.AI_PROVIDER ?? '').trim().toLowerCase()
  if (requested)
    return PROVIDER_IDS.includes(requested as ProviderId)
      ? BUILDERS[requested as ProviderId](env)
      : null
  for (const id of AUTO_ORDER) {
    const provider = BUILDERS[id](env)
    if (provider) return provider
  }
  // Ollama is local to the server, so it is never guessed at.
  return env.OLLAMA_BASE_URL || env.OLLAMA_MODEL ? ollama(env) : null
}
