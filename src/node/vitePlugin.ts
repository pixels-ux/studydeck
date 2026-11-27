import type { Plugin } from 'vite'
import { createApp } from '../server/app.ts'
import { backupRefusal, backupsFor, fileBackups } from './backups.ts'
import { readAiEnv } from './env.ts'
import { sendResponse, toRequest } from './http.ts'
import { openDatabase } from './sqlite.ts'

/**
 * In development Vite serves the client and hot reloads it; this middleware
 * hands `/api/*` to the same Hono app the built server runs, on the same data
 * file. One command, one origin, no proxy to keep in sync. The automatic copies
 * run here too, so they behave the same in both ways of starting Studydeck.
 */
export function studydeckApi(
  databasePath = process.env.DATABASE_PATH || 'data/studydeck.db',
): Plugin {
  return {
    name: 'studydeck-api',
    configureServer(server) {
      const app = createApp(openDatabase(databasePath), readAiEnv(), {
        backups: databasePath === ':memory:' ? undefined : fileBackups(databasePath),
      })
      const backups = backupsFor(databasePath, app)
      void backups?.startup()
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const method = req.method ?? 'GET'
        const path = req.url.split('?')[0] ?? req.url
        void (async () => {
          // A request that can empty something waits for its copy first.
          if (backups) await backups.before(method, path)
          const response = await app.fetch(toRequest(req))
          if (backups) backups.after(method, path, response.ok)
          return response
        })()
          .then((response) => sendResponse(response, res))
          .catch((error) => {
            const refusal = backupRefusal(error)
            if (refusal) {
              void sendResponse(refusal, res).catch(next)
              return
            }
            next(error)
          })
      })
    },
  }
}
