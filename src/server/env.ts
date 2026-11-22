/**
 * Configuration the app reads at startup. Everything is optional: the study
 * desk can also be connected from inside the app, and the rest of Studydeck
 * never needs a key at all.
 */
export type Env = {
  AI_PROVIDER?: string
  /** Any OpenAI-compatible endpoint; wins over the per-provider defaults. */
  AI_BASE_URL?: string
  AI_MODEL?: string
  OPENROUTER_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  GROQ_API_KEY?: string
  MISTRAL_API_KEY?: string
  DEEPSEEK_API_KEY?: string
  TOGETHER_API_KEY?: string
  /** Key for a service named by AI_BASE_URL with AI_PROVIDER=custom. */
  AI_API_KEY?: string
  /** Freebuff by default; OpenAI itself with `AI_PROVIDER=openai`. */
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  /** A local Ollama server, e.g. http://127.0.0.1:11434/v1. */
  OLLAMA_BASE_URL?: string
  OLLAMA_MODEL?: string
}
