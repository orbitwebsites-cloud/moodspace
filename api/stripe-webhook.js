// ============================================================
// api/stripe-webhook.js — Vercel Serverless Function
//
// Receives Stripe lifecycle events and syncs Pro status in Supabase.
//
// Set your webhook URL in Stripe Dashboard:
//   https://dashboard.stripe.com → Developers → Webhooks → Add endpoint
//   URL: https://your-vercel-app.vercel.app/api/stripe-webhook
//   Events to subscribe:
//     checkout.session.completed
//     customer.subscription.deleted
//     customer.subscription.updated
//     invoice.payment_failed
//
// Vercel env vars required:
//   STRIPE_WEBHOOK_SECRET    (whsec_... — from Stripe webhook dashboard)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (service role needed — no user JWT in webhook context)
// ============================================================

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Verify the webhook signature to confirm it came from Stripe
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing stripe-signature header')

  const parts     = sigHeader.split(',')
  const tPart     = parts.find(p => p.startsWith('t='))
  const sigPart   = parts.find(p => p.startsWith('v1='))
  if (!tPart || !sigPart) throw new Error('Malformed stripe-signature header')

  const timestamp = tPart.slice(2)
  const signature = sigPart.slice(3)

  // Reject events older than 5 minutes
  const tolerance = 300
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > tolerance) {
    throw new Error('Webhook timestamp outside tolerance window')
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const sigBuf = Buffer.from(signature, 'hex')
  const expBuf = Buffer.from(expectedSig, 'hex')

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Signature mismatch')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Read raw body for signature verification
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString()

  // Verify webhook signature (skip only if secret is not configured — dev only)
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (webhookSecret) {
    try {
      verifyStripeSignature(rawBody, req.headers['stripe-signature'], webhookSecret)
    } catch (err) {
      console.error('[Webhook] Signature verification failed:', err.message)
      return res.status(400).json({ error: 'Invalid signature: ' + err.message })
    }
  }

  const event   = JSON.parse(rawBody)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('[Stripe Webhook] Event:', event.type)

  try {
    if (event.type === 'checkout.session.completed') {
      const session        = event.data.object
      const userId         = session.client_reference_id
      const subscriptionId = session.subscription
      const customerId     = session.customer

      if (!userId) {
        console.error('[Webhook] No client_reference_id in checkout session')
        return res.status(200).json({ received: true })
      }

      const { error } = await supabase.from('profiles').update({
        is_pro:             true,
        stripe_sub_id:      subscriptionId,
        stripe_customer_id: customerId,
        pro_since:          new Date().toISOString(),
        pro_cancelled_at:   null,
      }).eq('id', userId)

      if (error) console.error('[Webhook] Supabase activate error:', error.message)
      else console.log('[Webhook] Pro activated for user:', userId)

    } else if (
      event.type === 'customer.subscription.deleted' ||
      (event.type === 'customer.subscription.updated' &&
       ['canceled', 'unpaid', 'incomplete_expired'].includes(event.data.object.status))
    ) {
      const sub = event.data.object

      const { error } = await supabase.from('profiles').update({
        is_pro:           false,
        pro_cancelled_at: new Date().toISOString(),
      }).eq('stripe_sub_id', sub.id)

      if (error) console.error('[Webhook] Supabase deactivate error:', error.message)
      else console.log('[Webhook] Pro deactivated for sub:', sub.id)

    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object
      console.log('[Webhook] Payment failed for customer:', invoice.customer)
      // Stripe will automatically cancel after retry window — handled by subscription.deleted
    }

    return res.status(200).json({ received: true })

  } catch (err) {
    console.error('[Stripe Webhook] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
