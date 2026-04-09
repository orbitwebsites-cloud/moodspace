// ============================================================
// api/paypal-webhook.js — Vercel Serverless Function
//
// Receives lifecycle events from PayPal (cancellation, payment
// failure, suspension) and syncs Pro status in Supabase.
//
// Set your webhook URL in PayPal Developer Dashboard:
//   https://developer.paypal.com → My Apps → [App] → Webhooks
//   URL: https://your-vercel-app.vercel.app/api/paypal-webhook
//   Events to subscribe:
//     BILLING.SUBSCRIPTION.CANCELLED
//     BILLING.SUBSCRIPTION.EXPIRED
//     BILLING.SUBSCRIPTION.SUSPENDED
//     BILLING.SUBSCRIPTION.ACTIVATED (optional re-activation)
//
// Vercel env vars required:
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_MODE          ("sandbox" | "live")
//   PAYPAL_WEBHOOK_ID    (from PayPal Developer Dashboard)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  ← service role needed (no user JWT here)
// ============================================================

import { createClient } from '@supabase/supabase-js'

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64')
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  return data.access_token
}

// Verify the webhook came from PayPal (not spoofed)
async function verifyWebhook(req, token, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!webhookId) {
    // NEVER skip verification in production — reject the request
    if (process.env.PAYPAL_MODE === 'live') {
      console.error('[Webhook] PAYPAL_WEBHOOK_ID is not set — rejecting in live mode')
      return false
    }
    console.warn('[Webhook] ⚠️ Skipping verification (sandbox dev only — set PAYPAL_WEBHOOK_ID for production)')
    return true
  }

  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo:         req.headers['paypal-auth-algo'],
      cert_url:          req.headers['paypal-cert-url'],
      transmission_id:   req.headers['paypal-transmission-id'],
      transmission_sig:  req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id:        webhookId,
      webhook_event:     JSON.parse(rawBody),
    }),
  })
  const data = await res.json()
  return data.verification_status === 'SUCCESS'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Read raw body for webhook verification
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString()
  const event   = JSON.parse(rawBody)

  try {
    const token = await getPayPalToken()
    const valid = await verifyWebhook(req, token, rawBody)
    if (!valid) {
      console.error('[Webhook] Invalid signature')
      return res.status(400).json({ error: 'Invalid signature' })
    }

    const subscriptionId = event.resource?.id
    const eventType      = event.event_type

    console.log('[Webhook] Event:', eventType, 'sub:', subscriptionId)

    // Use service role key — no user JWT available in webhook context
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    if (['BILLING.SUBSCRIPTION.CANCELLED',
         'BILLING.SUBSCRIPTION.EXPIRED',
         'BILLING.SUBSCRIPTION.SUSPENDED'].includes(eventType)) {

      const { error } = await supabase.from('profiles')
        .update({ is_pro: false, pro_cancelled_at: new Date().toISOString() })
        .eq('paypal_sub_id', subscriptionId)

      if (error) console.error('[Webhook] Supabase error:', error.message)
      else console.log('[Webhook] Pro deactivated for sub:', subscriptionId)

    } else if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      await supabase.from('profiles')
        .update({ is_pro: true, pro_cancelled_at: null })
        .eq('paypal_sub_id', subscriptionId)
    }

    return res.status(200).json({ received: true })
  } catch (err) {
    console.error('[Webhook] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
