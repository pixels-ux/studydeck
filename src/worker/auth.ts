import { createFreebuffAuth } from '@freebuff/auth'
import type { FreebuffAuth, FreebuffUser } from '@freebuff/auth'
import type { SqlDatabase } from './sql'

export type Env = {
  /** Static asset handler: the Sites `ASSETS` binding or the Node file server. */
  ASSETS: { fetch(request: Request): Promise<Response> }
  DB?: SqlDatabase
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
  /**
   * Local development only: the hostname of a proxied dev-server preview that
   * should use the single preview identity. Kept in `.dev.vars`, which is not
   * committed or deployed, so a hosted origin can never match it.
   */
  DEV_PREVIEW_HOST?: string
  /**
   * AI study desk. One provider is chosen by `AI_PROVIDER`, or detected from
   * the keys below; see `src/worker/providers.ts`. Keys stay on the server.
   */
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

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLocalPreview(request: Request, env: Env): boolean {
  if (env.FREEBUFF_CLIENT_ID || env.APP_ORIGIN) return false
  const hostname = new URL(request.url).hostname
  if (LOOPBACK.has(hostname)) return true
  // A cloud preview reaches the dev server through a proxy hostname, so the
  // loopback rule alone would hide the app behind the sign-in screen.
  return Boolean(env.DEV_PREVIEW_HOST) && hostname === env.DEV_PREVIEW_HOST
}

let cached: { key: string; auth: FreebuffAuth } | undefined

export function getAuth(env: Env): FreebuffAuth | null {
  if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN) return null
  // The canonical origin comes from Sites, never from a request Host header.
  const origin = new URL(env.APP_ORIGIN)
  const key = JSON.stringify([
    env.FREEBUFF_CLIENT_ID,
    env.FREEBUFF_ISSUER,
    env.APP_ORIGIN,
  ])
  if (cached?.key !== key) {
    cached = {
      key,
      auth: createFreebuffAuth({
        clientId: env.FREEBUFF_CLIENT_ID,
        issuer: env.FREEBUFF_ISSUER || undefined,
        baseUrl: env.APP_ORIGIN,
        allowInsecureLocalhost:
          origin.protocol === 'http:' && LOOPBACK.has(origin.hostname),
      }),
    }
  }
  return cached.auth
}

export async function currentUser(
  request: Request,
  env: Env,
): Promise<FreebuffUser | null> {
  const auth = getAuth(env)
  if (auth) return auth.getUser(request)
  // A single preview identity keeps first run usable without provisioning.
  // This fallback never applies on a hosted origin or to incomplete auth config.
  return isLocalPreview(request, env)
    ? { sub: 'local-preview', name: 'Local preview' }
    : null
}

export function appOrigin(request: Request, env: Env): string | null {
  return (
    env.APP_ORIGIN ||
    (isLocalPreview(request, env) ? new URL(request.url).origin : null)
  )
}
