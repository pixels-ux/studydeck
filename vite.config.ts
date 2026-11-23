import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { studydeckApi } from './src/node/vitePlugin.ts'

export default defineConfig({
  plugins: [react(), studydeckApi()],
  server: { port: 3000, host: '0.0.0.0' },
  build: { outDir: 'dist/client', emptyOutDir: true },
})
