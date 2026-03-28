// ============================================================
// supabase.js — Async Supabase client init for auth + dashboard
// Waits for config-loader.js to resolve before creating the client
// ============================================================

// _supabaseReady is a Promise — auth.js and dashboard.js await it
window._supabaseReady = window._configReady.then(cfg => {
  const { createClient } = window.supabase  // from Supabase CDN

  window.supabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  console.log('[Supabase] Client initialized')
  return window.supabaseClient
}).catch(err => {
  console.error('[Supabase] Init failed:', err.message)
  throw err
})
