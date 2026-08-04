import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config.
 *
 * Note the .mjs extension: this project is CommonJS (the scrapers use
 * require()), so the config has to opt into ES modules explicitly.
 *
 * In development Vite serves the UI on :5173 and proxies /api to the Node API
 * on :3001, which keeps the browser on a single origin — no CORS setup needed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
