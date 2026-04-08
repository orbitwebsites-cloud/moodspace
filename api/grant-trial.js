// ============================================================
// api/grant-trial.js — Vercel Serverless Function
//
// Grants a 3-day Pro trial after validating that the user
// has actually submitted a review. Prevents the client from
// setting pro_trial_expires_at directly.
//
// Vercel env vars required:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Authenticate the user
  const authHeader = req.headers.authorization || ''
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  try {
    // Verify a review actually exists for this user
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (reviewError) throw reviewError

    if (!review) {
      return res.status(400).json({ error: 'No review found — submit a review first' })
    }

    // Check if already has an active trial or paid Pro
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro, pro_trial_expires_at')
      .eq('id', user.id)
      .single()

    if (profile?.is_pro) {
      return res.status(200).json({ success: true, message: 'Already a Pro subscriber' })
    }

    if (profile?.pro_trial_expires_at && new Date(profile.pro_trial_expires_at) > new Date()) {
      return res.status(200).json({ success: true, message: 'Trial already active' })
    }

    // Grant 3-day trial
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 3)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ pro_trial_expires_at: expiresAt.toISOString() })
      .eq('id', user.id)

    if (updateError) throw updateError

    console.log('[Trial] 3-day Pro trial granted for user:', user.id.substring(0, 8))
    return res.status(200).json({ success: true, expiresAt: expiresAt.toISOString() })
  } catch (err) {
    console.error('[Trial] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
