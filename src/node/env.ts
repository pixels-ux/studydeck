import type { Env } from '../server/env'

const KEYS = [
  'AI_PROVIDER',
  'AI_BASE_URL',
  'AI_MODEL',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'AI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
] as const

/** Only the variables this app knows about, so nothing else leaks in. */
export function readAiEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const env: Record<string, string> = {}
  for (const key of KEYS) {
    const value = source[key]
    if (value) env[key] = value
  }
  return env as Env
}
