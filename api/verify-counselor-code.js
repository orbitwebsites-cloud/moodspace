// ============================================================
// api/verify-counselor-code.js — Vercel Serverless Function
// Verifies a school staff code using Supabase and securely elevates
// the user to 'counselor' bypassing broken client-side updates.
// ============================================================

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, school } = req.body
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false })
  }

  const supabaseUrl  = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY
  const serviceRole  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnon || !serviceRole) {
    console.error('[CounselorVerify] Missing Supabase env vars')
    return res.status(500).json({ valid: false, error: 'Server misconfigured' })
  }

  // Get user's JWT
  const authHeader = req.headers.authorization || ''
  const jwt = authHeader.replace('Bearer ', '').trim()
  if (!jwt) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // Authenticate user
  const supabaseAuth = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  try {
    // 1. Verify code against school_codes
    const url = `${supabaseUrl}/rest/v1/school_codes?code=eq.${encodeURIComponent(code.trim().toUpperCase())}&active=eq.true&select=school_name&limit=1`
    const apiRes = await fetch(url, {
      headers: {
        'apikey':        supabaseAnon,
        'Authorization': `Bearer ${supabaseAnon}`,
        'Accept':        'application/json'
      }
    })

    if (!apiRes.ok) throw new Error(`Supabase error ${apiRes.status}`)
    const rows = await apiRes.json()
    if (!rows || rows.length === 0) {
      return res.status(200).json({ valid: false })
    }

    const verifiedSchool = rows[0].school_name

    // 2. Escalate privileges via service_role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, serviceRole)
    const { error: updateError } = await supabaseAdmin.from('profiles').update({
       role: 'counselor',
       school: verifiedSchool || school
    }).eq('id', user.id)

    if (updateError) throw updateError

    console.log('[CounselorVerify] Valid code & role escalated for user:', user.id)
    return res.status(200).json({ valid: true, school: verifiedSchool || school })

  } catch (err) {
    console.error('[CounselorVerify] Error:', err.message)
    return res.status(500).json({ valid: false, error: 'Verification failed' })
  }
}
