// ============================================================
// api/chat.js — Vercel Serverless Function
// Proxies AI chat requests to protect API keys.
//
// Security:
//   ✅ Requires valid Supabase JWT (no anonymous access)
//   ✅ Looks up isPro from the DB (can't be spoofed by client)
//   ✅ Per-IP rate limiting (10 req/min)
//   ✅ Origin validation
//   ✅ Input validation (messages array, max length)
// ============================================================

import { createClient } from '@supabase/supabase-js'

// ── Rate limiter (in-memory, resets on cold start) ──────────
const ipBuckets = new Map()
const RATE_LIMIT = { max: 10, windowMs: 60_000 }

function isRateLimited(ip) {
  const now = Date.now()
  let bucket = ipBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT.windowMs }
    ipBuckets.set(ip, bucket)
  }
  bucket.count++
  return bucket.count > RATE_LIMIT.max
}

// ── Origin validation ───────────────────────────────────────
function isAllowedOrigin(req) {
  const origin = req.headers.origin || ''
  // Allow Vercel preview/production URLs and local dev
  if (!origin) return true // same-origin requests have no Origin header
  const allowed = [
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
  ].filter(Boolean)
  return allowed.some(a => origin.startsWith(a))
}

export default async function handler(req, res) {
  // ── Method check ──────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Origin check ──────────────────────────────────────────
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // ── Rate limit ────────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again in a minute' })
  }

  // ── Authentication ────────────────────────────────────────
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

  // ── Server-side Pro check ─────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_pro, pro_trial_expires_at')
    .eq('id', user.id)
    .single()

  const isPro = profile?.is_pro ||
    (profile?.pro_trial_expires_at && new Date(profile.pro_trial_expires_at) > new Date())

  // ── Input validation ──────────────────────────────────────
  const { messages } = req.body

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid messages array' })
  }

  // Cap message count and individual message length
  const sanitizedMessages = messages.slice(0, 30).map(m => ({
    role: typeof m.role === 'string' ? m.role.substring(0, 20) : 'user',
    content: typeof m.content === 'string' ? m.content.substring(0, 4000) : ''
  }))

  // ── AI provider waterfall ─────────────────────────────────
  const clod   = process.env.CLOD_API_KEY
  const gemini = process.env.GEMINI_API_KEY

  const CLOD_URL   = 'https://api.clod.io/v1/chat/completions'
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

  const providers = [
    gemini && { label: 'Gemini-2.0-Flash',  endpoint: GEMINI_URL, apiKey: gemini, model: 'gemini-2.0-flash' },
    gemini && { label: 'Gemini-1.5-Flash',  endpoint: GEMINI_URL, apiKey: gemini, model: 'gemini-1.5-flash' },
    clod && { label: 'Trinity-Mini',        endpoint: CLOD_URL, apiKey: clod, model: 'trinity-mini' },
    clod && { label: 'Llama-3.3-70B-Free',  endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Llama-3.3-70B-Instruct' },
    clod && { label: 'GPT-OSS-120B',        endpoint: CLOD_URL, apiKey: clod, model: 'gpt-oss-120b' },
    clod && { label: 'GPT-OSS-20B',         endpoint: CLOD_URL, apiKey: clod, model: 'gpt-oss-20b' },
    clod && { label: 'GLM-4.5-Air',         endpoint: CLOD_URL, apiKey: clod, model: 'glm-4.5-air' },
    clod && { label: 'Qwen3-Next-80B',      endpoint: CLOD_URL, apiKey: clod, model: 'Qwen/Qwen3-Next-80B-A3B-Instruct' },
    clod && { label: 'DeepSeek-V3.2',       endpoint: CLOD_URL, apiKey: clod, model: 'deepseek-ai/DeepSeek-V3-0324' },
    clod && { label: 'DeepSeek-V3',         endpoint: CLOD_URL, apiKey: clod, model: 'deepseek-ai/DeepSeek-V3' },
    clod && { label: 'Minimax-M2.5',        endpoint: CLOD_URL, apiKey: clod, model: 'MiniMax/MiniMax-M2.5' },
    clod && { label: 'Mistral-Small-3',     endpoint: CLOD_URL, apiKey: clod, model: 'mistralai/Mistral-Small-3.1-24B-Instruct-2503' },
    clod && { label: 'Llama-3.3-70B-Turbo', endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
    clod && { label: 'Llama-4-Maverick',    endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8' },
    clod && { label: 'Gemma-3N-E4B',        endpoint: CLOD_URL, apiKey: clod, model: 'google/gemma-3n-e4b-it' },
    clod && { label: 'Qwen2.5-7B-Turbo',    endpoint: CLOD_URL, apiKey: clod, model: 'Qwen/Qwen2.5-7B-Instruct-Turbo' },
    clod && { label: 'Llama-3.1-8B-Turbo',  endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
    clod && { label: 'Llama-3.2-3B-Turbo',  endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo' },
    clod && { label: 'Mixtral-8x7B',        endpoint: CLOD_URL, apiKey: clod, model: 'mistralai/Mixtral-8x7B-Instruct-v0.1' },
    clod && { label: 'Llama-3-8B-Lite',     endpoint: CLOD_URL, apiKey: clod, model: 'meta-llama/Llama-3-8b-chat-hf' },
  ].filter(Boolean)

  if (providers.length === 0) {
    return res.status(500).json({ error: 'No AI providers configured. Add GEMINI_API_KEY or CLOD_API_KEY in Vercel environment variables.' })
  }

  const maxTokens = isPro ? 500 : 300

  let lastErr
  for (const provider of providers) {
    try {
      const apiRes = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model:       provider.model,
          messages:    sanitizedMessages,
          max_tokens:  maxTokens,
          temperature: 0.8
        })
      })

      if (!apiRes.ok) {
        const body = await apiRes.text()
        throw new Error(`${apiRes.status}: ${body}`)
      }

      const json = await apiRes.json()
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('Empty response from ' + provider.label)

      console.log(`[AI] Success via ${provider.label} for user ${user.id.substring(0, 8)}`)
      return res.status(200).json({ text, provider: provider.label })
    } catch (err) {
      console.warn(`[AI] ${provider.label} failed:`, err.message)
      lastErr = err
    }
  }

  return res.status(500).json({ error: lastErr ? lastErr.message : 'All AI providers failed' })
}
