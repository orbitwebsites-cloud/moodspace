// ============================================================
// api/chat.js — Vercel Serverless Function
//
// Waterfall AI provider system — tries each provider in order
// until one succeeds. OpenAI keys rotate across multiple models.
//
// Vercel env vars (set as many OpenAI keys as you have):
//   OPENAI_KEY_1, OPENAI_KEY_2, ... OPENAI_KEY_N
//   OPENROUTER_API_KEY   (openrouter.ai — many free models)
//   MODELSLAB_API_KEY    (modelslab.com)
//   CLOD_API_KEY         (clod.io)
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, isPro } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing or invalid messages array' })
  }

  const maxTokens = isPro ? 500 : 300

  // ── Collect all configured OpenAI keys ──────────────────────
  const openAiKeys = []
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`OPENAI_KEY_${i}`]
    if (key) openAiKeys.push(key)
  }
  // Also accept the generic name
  if (process.env.OPENAI_API_KEY) openAiKeys.push(process.env.OPENAI_API_KEY)

  // ── OpenAI providers — one entry per key × model combo ──────
  // Ordered from cheapest/fastest to most capable
  const openAiModels = [
    { model: 'gpt-4o-mini',        label: 'OpenAI/gpt-4o-mini'   },
    { model: 'gpt-3.5-turbo',      label: 'OpenAI/gpt-3.5-turbo' },
    { model: 'gpt-4o',             label: 'OpenAI/gpt-4o'        },
    { model: 'gpt-4-turbo',        label: 'OpenAI/gpt-4-turbo'   },
  ]

  const openAiProviders = []
  for (const key of openAiKeys) {
    for (const { model, label } of openAiModels) {
      openAiProviders.push({
        label,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey:   key,
        model,
      })
    }
  }

  // ── OpenRouter providers (multiple free/cheap models) ────────
  const orKey = process.env.OPENROUTER_API_KEY
  const openRouterProviders = orKey ? [
    { label: 'OpenRouter/mistral-7b',     model: 'mistralai/mistral-7b-instruct:free',          endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
    { label: 'OpenRouter/llama-3.1-8b',   model: 'meta-llama/llama-3.1-8b-instruct:free',       endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
    { label: 'OpenRouter/gemma-2-9b',     model: 'google/gemma-2-9b-it:free',                   endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
    { label: 'OpenRouter/qwen-2.5-7b',    model: 'qwen/qwen-2.5-7b-instruct:free',              endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
    { label: 'OpenRouter/deepseek-r1',    model: 'deepseek/deepseek-r1:free',                   endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
    { label: 'OpenRouter/llama-3.3-70b',  model: 'meta-llama/llama-3.3-70b-instruct:free',      endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey },
  ] : []

  // ── ModelsLab ────────────────────────────────────────────────
  const mlKey = process.env.MODELSLAB_API_KEY
  const modelsLabProviders = mlKey ? [
    { label: 'ModelsLab/Llama-3.1-8b', endpoint: 'https://modelslab.com/api/uncensored-chat/v1/chat/completions', apiKey: mlKey, model: 'ModelsLab/Llama-3.1-8b-Uncensored-Dare' },
  ] : []

  // ── Clod.io ──────────────────────────────────────────────────
  const clodKey = process.env.CLOD_API_KEY
  const clodProviders = clodKey ? [
    { label: 'Clod/Llama-3.3-70B',  endpoint: 'https://api.clod.io/v1/chat/completions', apiKey: clodKey, model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
    { label: 'Clod/Trinity-Mini',   endpoint: 'https://api.clod.io/v1/chat/completions', apiKey: clodKey, model: 'trinity-mini' },
  ] : []

  // ── Full waterfall — OpenAI first, then others as fallback ───
  const providers = [
    ...openAiProviders,
    ...openRouterProviders,
    ...modelsLabProviders,
    ...clodProviders,
  ]

  if (providers.length === 0) {
    return res.status(500).json({ error: 'No AI providers configured. Add at least OPENAI_KEY_1 or OPENROUTER_API_KEY in Vercel environment variables.' })
  }

  let lastErr
  for (const provider of providers) {
    try {
      const apiRes = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          // OpenRouter requires these headers
          'HTTP-Referer':  'https://moodspace.app',
          'X-Title':       'MoodSpace',
        },
        body: JSON.stringify({
          model:       provider.model,
          messages,
          max_tokens:  maxTokens,
          temperature: 0.75,
        }),
      })

      if (!apiRes.ok) {
        const body = await apiRes.text()
        throw new Error(`${provider.label} → HTTP ${apiRes.status}: ${body.slice(0, 200)}`)
      }

      const json = await apiRes.json()
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error(`Empty response from ${provider.label}`)

      console.log(`[AI] Success with ${provider.label}`)
      return res.status(200).json({ text, provider: provider.label })

    } catch (err) {
      console.warn(`[AI] ${provider.label} failed:`, err.message)
      lastErr = err
    }
  }

  return res.status(500).json({ error: 'All AI providers failed. Last error: ' + (lastErr?.message || 'unknown') })
}
