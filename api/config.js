// ============================================================
// api/config.js — Vercel Serverless Function
// Reads keys from Vercel Environment Variables and returns them
// to the client at runtime. Keys never touch your git repo.
//
// Set these in: Vercel Dashboard → Your Project → Settings → Environment Variables
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   GEMINI_API_KEY             (primary AI - backend only, never returned here)
//   MODELSLAB_API_KEY          (fallback AI - backend only, never returned here)
//   CLOD_API_KEY               (fallback AI - backend only, never returned here)
//   OPENROUTER_API_KEY         (last-resort AI - backend only, never returned here)
//   STRIPE_PUBLISHABLE_KEY     (public — safe to expose, starts with pk_)
//   STRIPE_SECRET_KEY          ← backend only, never returned here
//   STRIPE_PRICE_ID            ← backend only, never returned here
//   STRIPE_WEBHOOK_SECRET      ← backend only, never returned here
//   SUPABASE_SERVICE_ROLE_KEY  ← backend only, never returned here
// ============================================================

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Origin validation — only allow requests from our own app
  const origin = req.headers.origin || ''
  if (origin) {
    const allowed = [
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
      process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      'http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000',
    ].filter(Boolean)
    if (!allowed.some(a => origin.startsWith(a))) {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  const supabaseUrl         = process.env.SUPABASE_URL
  const supabaseAnonKey     = process.env.SUPABASE_ANON_KEY
  // AI keys (GEMINI_API_KEY, CLOD_API_KEY, etc.) are read in api/chat.js only — never exposed here
  const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Config] Missing Supabase env vars')
    return res.status(500).json({
      error: 'Server misconfigured — add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel dashboard'
    })
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    stripePublishableKey,
  })
}
