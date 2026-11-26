import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/app.ts'
import { resolveProvider } from '../server/providers.ts'
import { automaticBackups, BACKUP_KEEP, backupFolder } from './backups.ts'
import { readAiEnv } from './env.ts'
import { sendResponse, toRequest } from './http.ts'
import { openDatabase } from './sqlite.ts'

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

/** The built client from `dist/client`, with a single-page fallback. */
async function serveAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405 })
  const index = join(staticDir, 'index.html')
  if (!existsSync(index))
    return new Response(
      'The client is not built yet. Run `bun run build` first.',
      { status: 500 },
    )
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

const app = createApp(openDatabase(databasePath), readAiEnv())

/**
 * Automatic copies read from the app's own export route, so they are exactly
 * the file Import a backup reads. The app itself never touches the disk.
 */
const readBackup = async (): Promise<string | null> => {
  try {
    const response = await app.fetch(new Request('http://localhost/api/export'))
    return response.ok ? await response.text() : null
  } catch (error) {
    console.error('Could not read the workspace for a backup.', error)
    return null
  }
}
const backups =
  databasePath === ':memory:'
    ? null
    : automaticBackups(databasePath, readBackup)
void backups?.startup()

const server = createServer(async (req, res) => {
  // Nothing outside the API can change the data, so only it is backed up.
  const apiPath = req.url?.startsWith('/api/')
    ? (req.url.split('?')[0] ?? req.url)
    : ''
  const method = req.method ?? 'GET'
  try {
    // A request that can empty something waits for its copy first.
    if (backups && apiPath) await backups.before(method, apiPath)
    const request = toRequest(req)
    const response = apiPath
      ? await app.fetch(request)
      : await serveAsset(request)
    if (backups && apiPath) backups.after(method, apiPath, response.ok)
    await sendResponse(response, res)
  } catch (error) {
    console.error('Request failed', error)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('Something went wrong.')
  }
})

server.listen(port, host, () => {
  console.log(`Studydeck on http://localhost:${port}`)
  console.log(`Your data file: ${resolve(databasePath)}`)
  if (backups)
    console.log(
      `Automatic backups: ${backupFolder(databasePath)} (newest ${BACKUP_KEEP})`,
    )
  const provider = resolveProvider(readAiEnv())
  if (provider)
    console.log(`AI desk: ${provider.label} (${provider.model})`)
  else
    console.log(
      'AI desk: not connected. Add a key under Settings → API keys.',
    )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
