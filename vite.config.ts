import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'src/shared') } },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})
