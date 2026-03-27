import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

// Files referenced as plain <script src> in HTML — Vite skips these
// (can't bundle non-module scripts), so we copy them manually after build.
const legacyScripts = [
  'config-loader.js',
  'supabase.js',
  'auth.js',
  'dashboard.js',
  'app.js',
]

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:      resolve(__dirname, 'index.html'),
        auth:      resolve(__dirname, 'auth.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      }
    }
  },
  plugins: [
    {
      name: 'copy-legacy-scripts',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true })
        for (const file of legacyScripts) {
          try {
            copyFileSync(
              resolve(__dirname, file),
              resolve(__dirname, 'dist', file)
            )
            console.log(`[copy] ${file} → dist/${file}`)
          } catch {
            // file doesn't exist locally (e.g. config.js is gitignored) — skip
          }
        }
      }
    }
  ]
})
