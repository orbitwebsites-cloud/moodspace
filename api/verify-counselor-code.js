// ============================================================
// api/verify-counselor-code.js — Vercel Serverless Function
// Verifies a school staff code using Supabase REST API directly
// (no npm package needed — just fetch).
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code } = req.body
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false })
  }

  const supabaseUrl  = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnon) {
    console.error('[CounselorVerify] Missing Supabase env vars')
    return res.status(500).json({ valid: false, error: 'Server misconfigured' })
  }

  try {
    // Query school_codes table via Supabase REST API
    const url = `${supabaseUrl}/rest/v1/school_codes?code=eq.${encodeURIComponent(code.trim().toUpperCase())}&active=eq.true&select=school_name&limit=1`

    const apiRes = await fetch(url, {
      headers: {
        'apikey':        supabaseAnon,
        'Authorization': `Bearer ${supabaseAnon}`,
        'Accept':        'application/json'
      }
    })

    if (!apiRes.ok) {
      const body = await apiRes.text()
      throw new Error(`Supabase error ${apiRes.status}: ${body}`)
    }

    const rows = await apiRes.json()

    if (!rows || rows.length === 0) {
      return res.status(200).json({ valid: false })
    }

    const school = rows[0].school_name
    console.log('[CounselorVerify] Valid code for school:', school)
    return res.status(200).json({ valid: true, school })

  } catch (err) {
    console.error('[CounselorVerify] Error:', err.message)
    return res.status(500).json({ valid: false, error: 'Verification failed' })
  }
}
