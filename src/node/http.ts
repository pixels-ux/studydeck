import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

/** A Node request as the web `Request` the app's handlers expect. */
export function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'connection' || key === 'transfer-encoding')
      continue
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else headers.set(key, value)
  }
  const method = req.method || 'GET'
  // Behind an HTTPS proxy the browser sends an https Origin, so the rebuilt
  // URL has to use the same scheme or the app's same-origin check refuses the
  // write. `x-forwarded-proto` is the only thing that says which scheme was used.
  const forwarded = req.headers['x-forwarded-proto']
  const proto =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(',')[0]
      ?.trim() || 'http'
  const url = `${proto}://${req.headers.host || 'localhost'}${req.url || '/'}`
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req)
  return new Request(url, {
    method,
    headers,
    body,
    // Required by Node's fetch for streamed request bodies.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

/** Write a web `Response` back out through Node. */
export async function sendResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
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
