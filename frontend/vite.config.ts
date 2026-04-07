import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../src/xsafeclaw/static',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        agentTown: resolve(__dirname, 'agent-town.html'),
        agentValley: resolve(__dirname, 'agent-valley.html'),
      },
    },
  },
  server: {
    port: 3003,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:6874',
        changeOrigin: true,
      },
    },
  },
})
