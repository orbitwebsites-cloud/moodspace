// ============================================================
// config-loader.js — Loads app config for local dev + Vercel
//
// Local dev:  config.js already ran → window.MOODSPACE_CONFIG is set
//             This file detects that and skips the network call.
//
// Vercel:     config.js is gitignored (not in repo)
//             This file fetches /api/config which reads Vercel env vars.
//             No separate file upload ever needed.
// ============================================================

window._configReady = (async () => {
  // Local dev — config.js already set the global, use it immediately
  if (window.MOODSPACE_CONFIG?.supabaseUrl) {
    console.log('[Config] Loaded from local config.js')
    return window.MOODSPACE_CONFIG
  }

  // Vercel (or any host) — fetch from the serverless function
  try {
    const res = await fetch('/api/config')

    if (!res.ok) {
      throw new Error(
        `Config endpoint returned ${res.status}. ` +
        'Add SUPABASE_URL, SUPABASE_ANON_KEY in your Vercel project settings.'
      )
    }

    const cfg = await res.json()

    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('Config endpoint returned incomplete data — check Vercel env vars.')
    }

    window.MOODSPACE_CONFIG = cfg
    console.log('[Config] Loaded from /api/config (Vercel env vars)')
    return cfg
  } catch (err) {
    console.error('[Config] Failed to load:', err.message)
    throw err
  }
})()
