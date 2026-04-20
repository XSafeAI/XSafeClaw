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
        // start.sh exports BACKEND_PORT before launching Vite so the proxy
        // follows whatever port the FastAPI process is actually bound to
        // (since §27 that's 3022 by default). Falling back to 6874 keeps
        // "vite dev" standalone against "python run.py" working exactly
        // as it did before the port swap.
        target: `http://localhost:${process.env.BACKEND_PORT || 6874}`,
        changeOrigin: true,
        timeout: 180000,
      },
    },
  },
})
