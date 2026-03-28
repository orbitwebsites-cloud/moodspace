// ============================================================
// api/config.js — Vercel Serverless Function
// Reads keys from Vercel Environment Variables and returns them
// to the client at runtime. Keys never touch your git repo.
//
// Set these in: Vercel Dashboard → Your Project → Settings → Environment Variables
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   MODELSLAB_API_KEY          (primary AI - backend only, never returned here)
//   CLOD_API_KEY               (fallback AI - backend only, never returned here)
//   OPENROUTER_API_KEY         (last-resort AI - backend only, never returned here)
//   STRIPE_PUBLISHABLE_KEY     (pk_live_... — public, safe to expose)
//   STRIPE_PRICE_ID            (price_... — public, safe to expose)
//   STRIPE_SECRET_KEY          ← backend only, never returned here
//   STRIPE_WEBHOOK_SECRET      ← backend only, never returned here
//   SUPABASE_SERVICE_ROLE_KEY  ← backend only, never returned here
// ============================================================

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl           = process.env.SUPABASE_URL
  const supabaseAnonKey       = process.env.SUPABASE_ANON_KEY
  const modelsLabApiKey       = process.env.MODELSLAB_API_KEY
  const clodApiKey            = process.env.CLOD_API_KEY
  const openRouterApiKey      = process.env.OPENROUTER_API_KEY
  const stripePublishableKey  = process.env.STRIPE_PUBLISHABLE_KEY
  const stripePriceId         = process.env.STRIPE_PRICE_ID

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
    // Stripe public values (publishable key is safe to expose)
    stripePublishableKey,
    stripePriceId,
  })
}
