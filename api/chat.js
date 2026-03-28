// ============================================================
// api/chat.js — Vercel Serverless Function
// Proxies AI chat completion requests to protect API keys.
// Uses a waterfall approach: ModelsLab -> Clod -> OpenRouter
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, isPro } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing or invalid messages array' })
  }

  const keys = {
    modelsLab: process.env.MODELSLAB_API_KEY,
    clod: process.env.CLOD_API_KEY,
    openRouter: process.env.OPENROUTER_API_KEY
  }

  const providers = [
    // 1️⃣ ModelsLab
    keys.modelsLab && {
      label:    'ModelsLab',
      endpoint: 'https://modelslab.com/api/uncensored-chat/v1/chat/completions',
      apiKey:   keys.modelsLab,
      model:    'ModelsLab/Llama-3.1-8b-Uncensored-Dare'
    },
    // 2️⃣ Clod.io — Llama 3.3 70B
    keys.clod && {
      label:    'Clod/Llama-70B',
      endpoint: 'https://api.clod.io/v1/chat/completions',
      apiKey:   keys.clod,
      model:    'meta-llama/Llama-3.3-70B-Instruct-Turbo'
    },
    // 3️⃣ Clod.io — Trinity Mini
    keys.clod && {
      label:    'Clod/Trinity-Mini',
      endpoint: 'https://api.clod.io/v1/chat/completions',
      apiKey:   keys.clod,
      model:    'trinity-mini'
    },
    // 4️⃣ OpenRouter
    keys.openRouter && {
      label:    'OpenRouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   keys.openRouter,
      model:    'openrouter/free'
    }
  ].filter(Boolean)

  if (providers.length === 0) {
    return res.status(500).json({ error: 'No AI providers configured on the server.' })
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
          model: provider.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.75
        })
      })

      if (!apiRes.ok) {
        const body = await apiRes.text()
        throw new Error(`${apiRes.status}: ${body}`)
      }

      const json = await apiRes.json()
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('Empty response from ' + provider.label)

      return res.status(200).json({ text, provider: provider.label })
    } catch (err) {
      console.warn(`[AI] ${provider.label} failed:`, err.message)
      lastErr = err
    }
  }

  return res.status(500).json({ error: lastErr ? lastErr.message : 'All AI providers failed' })
}
