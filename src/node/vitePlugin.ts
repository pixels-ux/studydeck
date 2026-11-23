import type { Plugin } from 'vite'
import { createApp } from '../server/app.ts'
import { readAiEnv } from './env.ts'
import { sendResponse, toRequest } from './http.ts'
import { openDatabase } from './sqlite.ts'

/**
 * In development Vite serves the client and hot reloads it; this middleware
 * hands `/api/*` to the same Hono app the built server runs, on the same data
 * file. One command, one origin, no proxy to keep in sync.
 */
export function studydeckApi(
  databasePath = process.env.DATABASE_PATH || 'data/studydeck.db',
): Plugin {
  return {
    name: 'studydeck-api',
    configureServer(server) {
      const app = createApp(openDatabase(databasePath), readAiEnv())
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        void Promise.resolve(app.fetch(toRequest(req)))
          .then((response) => sendResponse(response, res))
          .catch(next)
      })
    },
  }
}
