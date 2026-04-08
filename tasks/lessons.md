# Lessons Learned
<!-- Claude appends a new rule here every time the user makes a correction -->

- Always check whether a CSS fix will affect other tabs before applying it (e.g. view-container changes)
- When adding new Supabase columns, apply the migration via MCP before writing any client code that references them
- The app uses vanilla JS (no framework) — never suggest React/Vue components
- API keys for AI providers live in Vercel env vars ONLY — never in client-side code
- `isPro()` must check both `is_pro` (paid subscriber) AND `pro_trial_expires_at` (review trial)
- The chat tab needs its own height-constrained flex layout — other tabs use normal block flow
- Vercel serverless functions live in /api — they are NOT available during `npm run dev` (Vite only); use `vercel dev` to test them locally
- Always use `supabase` (the client instance from supabase.js) not `supabaseClient` in main.js
