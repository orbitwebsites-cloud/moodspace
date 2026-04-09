// ============================================================
// api/stripe-checkout.js — Vercel Serverless Function
//
// Creates a Stripe Checkout Session for a Pro subscription.
// The session URL is returned to the client, which then
// redirects the user to Stripe's hosted checkout page.
//
// Vercel env vars required:
//   STRIPE_SECRET_KEY      (sk_live_... — never expose to client)
//   STRIPE_PRICE_ID        (price_... — your recurring price ID)
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   APP_URL                (e.g. https://yourapp.vercel.app — optional, falls back to Origin header)
//
// NOTE: Uses plain fetch against Supabase REST API — no npm packages needed.
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Require authenticated user
  const authHeader = req.headers.authorization || ''
  const userJwt    = authHeader.replace('Bearer ', '').trim()
  if (!userJwt) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const supabaseUrl  = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnon) {
    return res.status(500).json({ error: 'Supabase env vars not configured' })
  }

  // Verify token and get user via Supabase REST API (no npm package needed)
  let user
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey': supabaseAnon,
        'Authorization': `Bearer ${userJwt}`,
      }
    })

    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid session — please log in again' })
    }

    user = await userRes.json()
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid session — please log in again' })
    }
  } catch (err) {
    console.error('[Stripe] Supabase auth check failed:', err.message)
    return res.status(401).json({ error: 'Could not verify session' })
  }

  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    return res.status(500).json({ error: 'STRIPE_PRICE_ID not configured' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not configured' })
  }

  // Determine app base URL for redirect URLs
  const origin = process.env.APP_URL ||
    (req.headers.origin ? req.headers.origin : `https://${req.headers.host}`)

  try {
    // Create Stripe Checkout Session via REST API (no SDK needed)
    const params = new URLSearchParams()
    params.append('mode', 'subscription')
    params.append('payment_method_types[]', 'card')
    params.append('line_items[0][price]', priceId)
    params.append('line_items[0][quantity]', '1')
    params.append('client_reference_id', user.id)
    params.append('customer_email', user.email || '')
    params.append('success_url', `${origin}/?checkout=success`)
    params.append('cancel_url', `${origin}/checkout.html?cancelled=1`)
    params.append('allow_promotion_codes', 'true')

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await stripeRes.json()

    if (!stripeRes.ok) {
      console.error('[Stripe] Checkout session error:', session.error)
      return res.status(500).json({ error: session.error?.message || 'Could not create checkout session' })
    }

    console.log('[Stripe] Checkout session created:', session.id, 'for user:', user.id)
    return res.status(200).json({ url: session.url })

  } catch (err) {
    console.error('[Stripe] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
