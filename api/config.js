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
//   PAYPAL_CLIENT_ID           (public — safe to expose)
//   PAYPAL_PLAN_ID             (public — the subscription plan ID)
//   PAYPAL_MODE                ("sandbox" | "live")
//   PAYPAL_CLIENT_SECRET       ← backend only, never returned here
//   PAYPAL_WEBHOOK_ID          ← backend only, never returned here
//   SUPABASE_SERVICE_ROLE_KEY  ← backend only, never returned here
// ============================================================

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl      = process.env.SUPABASE_URL
  const supabaseAnonKey  = process.env.SUPABASE_ANON_KEY
  const modelsLabApiKey  = process.env.MODELSLAB_API_KEY
  const clodApiKey       = process.env.CLOD_API_KEY
  const openRouterApiKey = process.env.OPENROUTER_API_KEY
  const paypalClientId   = process.env.PAYPAL_CLIENT_ID
  const paypalPlanId     = process.env.PAYPAL_PLAN_ID
  const paypalMode       = process.env.PAYPAL_MODE || 'sandbox'

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
    // PayPal public values (client ID and plan ID are safe to expose)
    paypalClientId,
    paypalPlanId,
    paypalMode,
  })
}
