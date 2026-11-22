import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Two builds for hosts that run plain Node instead of Cloudflare Workers:
 *   vite build --config vite.node.config.ts                  -> dist/client
 *   vite build --config vite.node.config.ts --mode server    -> dist/node/server.js
 * `bun run build` and deploy.json are untouched and still target Sites.
 */
export default defineConfig(({ mode }) =>
  mode === 'server'
    ? {
        build: {
          ssr: 'src/node/server.ts',
          outDir: 'dist/node',
          target: 'node22',
          emptyOutDir: true,
        },
      }
    : {
        plugins: [react()],
        build: { outDir: 'dist/client', emptyOutDir: true },
      },
)
