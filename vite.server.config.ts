import { defineConfig } from 'vite'

/** `bun run build` builds the client first, then this server bundle. */
export default defineConfig({
  build: {
    ssr: 'src/node/server.ts',
    outDir: 'dist/server',
    target: 'node22',
    emptyOutDir: true,
  },
})
