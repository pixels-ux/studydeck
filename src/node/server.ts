import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import worker from '../worker/index'
import type { Env } from '../worker/auth'
import { resolveProvider } from '../worker/providers'
import { openDatabase } from './sqlite'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'
const databasePath = process.env.DATABASE_PATH || 'data/studydeck.db'
const staticDir = resolve(
  process.env.STATIC_DIR ||
    fileURLToPath(new URL('../client', import.meta.url)),
)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function fileResponse(path: string, pathname: string): Response {
  const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream'
  // Vite fingerprints everything under /assets, so those never change.
  const cache = pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  const stream = Readable.toWeb(
    createReadStream(path),
  ) as unknown as ReadableStream
  return new Response(stream, {
    headers: {
      'content-type': type,
      'cache-control': cache,
      'content-length': String(statSync(path).size),
    },
  })
}

/** Stands in for the Sites `ASSETS` binding: static files, then the SPA. */
async function serveAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405 })
  const index = join(staticDir, 'index.html')
  if (!existsSync(index)) return new Response('Not built', { status: 500 })
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (pathname.endsWith('/')) pathname += 'index.html'
  const path = resolve(staticDir, `.${pathname}`)
  if (path.startsWith(staticDir) && existsSync(path) && statSync(path).isFile())
    return fileResponse(path, pathname)
  // Client-side routes fall back to the single-page app shell.
  return fileResponse(index, pathname)
}

const env: Env = {
  ASSETS: { fetch: serveAsset },
  DB: openDatabase(databasePath),
  FREEBUFF_CLIENT_ID: process.env.FREEBUFF_CLIENT_ID,
  FREEBUFF_ISSUER: process.env.FREEBUFF_ISSUER,
  APP_ORIGIN: process.env.APP_ORIGIN,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  TOGETHER_API_KEY: process.env.TOGETHER_API_KEY,
  AI_API_KEY: process.env.AI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL,
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as Parameters<typeof worker.fetch>[2]

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'connection' || key === 'transfer-encoding')
      continue
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else headers.set(key, value)
  }
  const method = req.method || 'GET'
  const url = `http://${req.headers.host || `${host}:${port}`}${req.url || '/'}`
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req)
  return new Request(url, {
    method,
    headers,
    body: body as BodyInit | undefined,
    // Required by Node's fetch for streamed request bodies.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of response.headers) {
    if (key !== 'set-cookie') headers[key] = value
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  if (!response.body) {
    res.end()
    return
  }
  Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    const response = await worker.fetch(toRequest(req), env, ctx)
    await send(response, res)
  } catch (error) {
    console.error('Request failed', error)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('Something went wrong.')
  }
})

server.listen(port, host, () => {
  console.log(
    `Studydeck on http://${host}:${port} (database ${databasePath}, assets ${staticDir})`,
  )
  if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN)
    console.log(
      'Sign-in is off: set FREEBUFF_CLIENT_ID and APP_ORIGIN, then open the site on that origin.',
    )
  const provider = resolveProvider(env)
  console.log(
    provider
      ? `AI desk: ${provider.label} (${provider.model}) at ${provider.baseUrl}`
      : 'AI desk is off: set OPENROUTER_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY, or run Ollama.',
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
