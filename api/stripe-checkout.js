// ============================================================
// api/stripe-checkout.js — Vercel Serverless Function
//
// Creates a Stripe Checkout session for a Pro subscription.
// Returns the session URL — the client redirects to it.
//
// Vercel env vars required:
//   STRIPE_SECRET_KEY     (sk_live_... or sk_test_...)
//   STRIPE_PRICE_ID       (price_... from Stripe dashboard)
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
// ============================================================

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Origin validation
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

  // The user must be authenticated
  const authHeader = req.headers.authorization || ''
  const userJwt    = authHeader.replace('Bearer ', '').trim()
  if (!userJwt) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // Resolve the user's email from their JWT (needed for Stripe customer)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${userJwt}` } } }
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid session' })
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    // Build the success/cancel URLs — use origin header or production URL
    const appBase = origin ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'http://localhost:5173')

    const session = await stripe.checkout.sessions.create({
      mode:                'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price:    process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      customer_email: user.email,
      // Pass user ID so webhook can find the right profile
      client_reference_id: user.id,
      success_url: `${appBase}/?stripe=success`,
      cancel_url:  `${appBase}/?stripe=cancel`,
    })

    console.log('[Stripe] Checkout session created for user:', user.id)
    return res.status(200).json({ url: session.url })

  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
