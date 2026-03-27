import { defineConfig } from 'vite'
import { resolve } from 'path'

// Multi-page app — build all HTML entry points so they exist in dist/
// Without this, Vite only builds index.html and auth.html / dashboard.html
// are missing from production, causing blank screens and broken redirects.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:      resolve(__dirname, 'index.html'),
        auth:      resolve(__dirname, 'auth.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      }
    }
  }
})
