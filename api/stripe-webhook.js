// ============================================================
// api/stripe-webhook.js — Vercel Serverless Function
//
// Receives lifecycle events from Stripe and syncs Pro status
// in Supabase.
//
// Set your webhook URL in Stripe Dashboard → Developers → Webhooks:
//   URL: https://your-vercel-app.vercel.app/api/stripe-webhook
//   Events to subscribe:
//     checkout.session.completed
//     customer.subscription.deleted
//     customer.subscription.updated  (handles cancellations at period end)
//
// Vercel env vars required:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET  (whsec_... from Stripe webhook dashboard)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// Vercel parses the body by default — we need the raw bytes for signature verification
export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const rawBody = await getRawBody(req)
  const sig     = req.headers['stripe-signature']

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message)
    return res.status(400).json({ error: `Webhook error: ${err.message}` })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('[Stripe Webhook] Event:', event.type)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId  = session.client_reference_id
    const subId   = session.subscription

    if (!userId) {
      console.error('[Stripe Webhook] No client_reference_id on session')
      return res.status(400).json({ error: 'Missing user ID' })
    }

    const { error } = await supabase.from('profiles').update({
      is_pro:            true,
      stripe_sub_id:     subId,
      pro_since:         new Date().toISOString(),
      pro_cancelled_at:  null,
    }).eq('id', userId)

    if (error) console.error('[Stripe Webhook] Supabase update error:', error.message)
    else console.log('[Stripe Webhook] Pro activated for user:', userId)

  } else if (
    event.type === 'customer.subscription.deleted' ||
    (event.type === 'customer.subscription.updated' &&
      event.data.object.cancel_at_period_end === false &&
      event.data.object.status !== 'active')
  ) {
    const subId = event.data.object.id

    const { error } = await supabase.from('profiles').update({
      is_pro:           false,
      pro_cancelled_at: new Date().toISOString(),
    }).eq('stripe_sub_id', subId)

    if (error) console.error('[Stripe Webhook] Supabase update error:', error.message)
    else console.log('[Stripe Webhook] Pro deactivated for sub:', subId)
  }

  return res.status(200).json({ received: true })
}
