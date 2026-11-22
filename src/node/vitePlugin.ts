import type { Plugin } from 'vite'
import { createApp } from '../server/app'
import { readAiEnv } from './env'
import { sendResponse, toRequest } from './http'
import { openDatabase } from './sqlite'

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
