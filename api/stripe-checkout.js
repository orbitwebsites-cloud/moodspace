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
// ============================================================

import { createClient } from '@supabase/supabase-js'

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

  // Verify token and get user via Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${userJwt}` } } }
  )

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid session — please log in again' })
  }

  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    return res.status(500).json({ error: 'STRIPE_PRICE_ID not configured' })
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
    params.append('cancel_url', `${origin}/checkout.html`)
    params.append('allow_promotion_codes', 'true')

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
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
