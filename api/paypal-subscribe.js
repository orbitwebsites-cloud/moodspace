// ============================================================
// api/paypal-subscribe.js — Vercel Serverless Function
//
// Called by the frontend after the user approves a PayPal
// subscription. Verifies the subscription with PayPal's API
// (using the secret key, never exposed to client), then marks
// the user as Pro in Supabase using their own auth JWT.
//
// Vercel env vars required:
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_MODE          ("sandbox" | "live")
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js'

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

// Get a short-lived PayPal access token using client credentials
async function getPayPalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to get PayPal token')
  return data.access_token
}

// Verify subscription status directly with PayPal
async function getSubscription(subscriptionId, token) {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { subscriptionId } = req.body || {}
  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId required' })
  }

  // The user must be authenticated — get their JWT from the Authorization header
  const authHeader = req.headers.authorization || ''
  const userJwt    = authHeader.replace('Bearer ', '').trim()
  if (!userJwt) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    // 1️⃣ Verify subscription with PayPal
    const ppToken      = await getPayPalToken()
    const subscription = await getSubscription(subscriptionId, ppToken)

    if (subscription.status !== 'ACTIVE') {
      return res.status(402).json({
        error: `Subscription not active (status: ${subscription.status})`
      })
    }

    // 2️⃣ Update Supabase using the user's own JWT (RLS enforces they can only touch their own row)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${userJwt}` } } }
    )

    const { error } = await supabase.from('profiles').update({
      is_pro:       true,
      paypal_sub_id: subscriptionId,
      pro_since:    new Date().toISOString(),
      pro_cancelled_at: null,
    }).eq('id', (await supabase.auth.getUser()).data.user?.id)

    if (error) {
      console.error('[PayPal] Supabase update error:', error)
      return res.status(500).json({ error: 'Could not activate Pro: ' + error.message })
    }

    console.log('[PayPal] Pro activated for subscription:', subscriptionId)
    return res.status(200).json({ success: true, status: subscription.status })

  } catch (err) {
    console.error('[PayPal] Subscribe error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
