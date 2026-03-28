// ============================================================
// api/chat.js — Vercel Serverless Function
//
// Waterfall AI system — tries cheapest models first, falls back
// automatically. Each provider slot uses a different model to
// spread load and minimise cost.
//
// Vercel env vars (add whichever you have):
//   OPENROUTER_API_KEY   — openrouter.ai (many free models)
//   GEMINI_API_KEY       — Google AI Studio (gemini-2.0-flash-lite is free)
//   CLOD_API_KEY         — clod.io
//   MODELSLAB_API_KEY    — modelslab.com
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
  const orKey     = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY
  const clodKey   = process.env.CLOD_API_KEY
  const mlKey     = process.env.MODELSLAB_API_KEY

  // ── Provider waterfall ───────────────────────────────────────
  // Ordered: cheapest / free first → paid fallbacks last
  const providers = [

    // 1. OpenRouter — Llama 3.1 8B (free)
    orKey && {
      label:    'OpenRouter/llama-3.1-8b',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'meta-llama/llama-3.1-8b-instruct:free',
    },

    // 2. OpenRouter — Mistral 7B (free)
    orKey && {
      label:    'OpenRouter/mistral-7b',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'mistralai/mistral-7b-instruct:free',
    },

    // 3. Gemini 2.0 Flash Lite — cheapest Gemini, very fast (free tier)
    geminiKey && {
      label:    'Gemini/2.0-flash-lite',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey:   geminiKey,
      model:    'gemini-2.0-flash-lite',
    },

    // 4. OpenRouter — Gemma 2 9B (free)
    orKey && {
      label:    'OpenRouter/gemma-2-9b',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'google/gemma-2-9b-it:free',
    },

    // 5. Gemini 1.5 Flash 8B — tiny, cheap (free tier)
    geminiKey && {
      label:    'Gemini/1.5-flash-8b',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey:   geminiKey,
      model:    'gemini-1.5-flash-8b',
    },

    // 6. OpenRouter — Qwen 2.5 7B (free)
    orKey && {
      label:    'OpenRouter/qwen-2.5-7b',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'qwen/qwen-2.5-7b-instruct:free',
    },

    // 7. Clod — Trinity Mini (cheap)
    clodKey && {
      label:    'Clod/trinity-mini',
      endpoint: 'https://api.clod.io/v1/chat/completions',
      apiKey:   clodKey,
      model:    'trinity-mini',
    },

    // 8. OpenRouter — DeepSeek R1 (free)
    orKey && {
      label:    'OpenRouter/deepseek-r1',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'deepseek/deepseek-r1:free',
    },

    // 9. Gemini 1.5 Flash — slightly bigger (free tier)
    geminiKey && {
      label:    'Gemini/1.5-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey:   geminiKey,
      model:    'gemini-1.5-flash',
    },

    // 10. OpenRouter — Llama 3.3 70B (free, bigger = better quality)
    orKey && {
      label:    'OpenRouter/llama-3.3-70b',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey:   orKey,
      model:    'meta-llama/llama-3.3-70b-instruct:free',
    },

    // 11. Clod — Llama 3.3 70B (paid fallback)
    clodKey && {
      label:    'Clod/llama-3.3-70b',
      endpoint: 'https://api.clod.io/v1/chat/completions',
      apiKey:   clodKey,
      model:    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },

    // 12. ModelsLab — final fallback
    mlKey && {
      label:    'ModelsLab/llama-3.1-8b',
      endpoint: 'https://modelslab.com/api/uncensored-chat/v1/chat/completions',
      apiKey:   mlKey,
      model:    'ModelsLab/Llama-3.1-8b-Uncensored-Dare',
    },

  ].filter(Boolean)

  if (providers.length === 0) {
    return res.status(500).json({
      error: 'No AI providers configured. Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel environment variables.'
    })
  }

  let lastErr
  for (const provider of providers) {
    try {
      const apiRes = await fetch(provider.endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
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
        throw new Error(`HTTP ${apiRes.status}: ${body.slice(0, 200)}`)
      }

      const json = await apiRes.json()
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('Empty response')

      console.log(`[AI] Success via ${provider.label}`)
      return res.status(200).json({ text, provider: provider.label })

    } catch (err) {
      console.warn(`[AI] ${provider.label} failed:`, err.message)
      lastErr = err
    }
  }

  return res.status(500).json({
    error: 'All AI providers failed. Last error: ' + (lastErr?.message || 'unknown')
  })
}
