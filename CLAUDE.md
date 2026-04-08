@/root/.claude/primer.md
@.claude-memory.md

# PROJECT CONTEXT

**Name:** MoodSpace
**Type:** Teen mental wellness web app (Hackathon project)
**Stack:** Vanilla JS + HTML/CSS, Supabase (auth + DB), Vercel (serverless API + hosting), Vite (local dev)
**Repo root:** `D:\Hackathon Project Moody`
**Live URL:** Deployed on Vercel (check vercel.json for config)

## Key Files
| File | Purpose |
|------|---------|
| `main.js` | Core app logic — all tabs, state, rendering, event listeners |
| `style.css` | All styles — design system variables + component CSS |
| `index.html` | App shell |
| `api/chat.js` | Vercel serverless — AI provider waterfall (Gemini → Clod models) |
| `api/config.js` | Vercel serverless — serves env vars to client at runtime |
| `api/paypal-*.js` | PayPal subscription webhook + subscribe handler |
| `supabase.js` | Supabase client initialisation |
| `auth.js` / `auth.html` | Login / signup page |
| `dashboard.html` / `dashboard.js` | Counselor-only analytics dashboard |

## Supabase Tables
- `profiles` — user profile, `is_pro`, `pro_trial_expires_at`, `streak_count`, `role`
- `entries` — daily mood check-ins + journal entries + AI responses
- `streaks` — streak tracking per user
- `reviews` — one review per user (triggers 3-day Pro trial on submit)

## Pro Tiers
- **Free** — 3 AI responses/day, 7-day history, 2 themes
- **Trial** — 3 days Pro granted when user submits a review (`pro_trial_expires_at`)
- **Pro** — $8.99/mo via PayPal, sets `is_pro = true` via webhook

## Environment Variables (Vercel)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` — primary AI (free tier)
- `CLOD_API_KEY` — 16-model fallback waterfall
- `PAYPAL_CLIENT_ID`, `PAYPAL_PLAN_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE`

---

# PROJECT RULES

1. **Read `tasks/lessons.md` at the start of every session** before touching any code
2. **Update `tasks/todo.md`** as work progresses — move items Done ✅, add new items
3. Never use a framework — this is intentionally vanilla JS
4. Never put secrets in client-side code — all keys go through `/api/config` or Vercel env vars
5. Always apply Supabase migrations via MCP before writing client code that uses new columns
6. Test CSS changes for side-effects on other tabs before committing
