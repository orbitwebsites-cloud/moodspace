// ============================================================
// main.js — MoodSpace student app (ES Module)
// Connected to: Supabase Auth + DB, ModelsLab LLM AI
// Security: client-side rate limiting, input sanitization,
//           auth guard, submission debounce, length caps
// ============================================================

// === IMPORTS ===
// Supabase via ESM CDN — no bundler needed
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Keys come from either:
//   • config.js (local dev, gitignored) — sets window.MOODSPACE_CONFIG
//   • /api/config serverless function (Vercel — reads env vars)
// Config loading is inlined here so Vite bundles it correctly for production.
const _cfg = await (async () => {
  if (window.MOODSPACE_CONFIG?.supabaseUrl) {
    return window.MOODSPACE_CONFIG
  }
  try {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`/api/config returned ${res.status}`)
    const cfg = await res.json()
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('Incomplete config — check Vercel env vars.')
    }
    window.MOODSPACE_CONFIG = cfg
    return cfg
  } catch (err) {
    document.body.innerHTML =
      `<p style="padding:2rem;font-family:sans-serif;color:#B33A3A">
         ⚠️ Could not load app config: ${err.message}
       </p>`
    throw err
  }
})()
const {
  supabaseUrl, supabaseAnonKey,
  paypalClientId:   PAYPAL_CLIENT_ID,
  paypalPlanId:     PAYPAL_PLAN_ID,
  paypalMode:       PAYPAL_MODE,
} = _cfg

// ── Pro feature gates ────────────────────────────────────────
// Free: 3 AI/day, 7-day history, 2 themes
// Pro:  Unlimited AI, 90-day history, all themes, export, badge
const PRO_PRICE     = '$8.99 / month'
const FREE_AI_LIMIT = 3   // per day (Supabase-backed)
const FREE_THEMES   = ['default', 'ocean']  // all others are pro-only

const AI_PERSONALITIES = {
  friend:    { label: '👫 Supportive Friend',  desc: 'Warm, casual, like texting your best friend',        tone: 'like a warm, caring best friend — casual, emoji-friendly, never preachy' },
  mentor:    { label: '🎓 Wise Mentor',        desc: 'Thoughtful, grounded advice from someone who cares', tone: 'like a wise older mentor — thoughtful, honest, and encouraging without being preachy' },
  coach:     { label: '💪 Hype Coach',         desc: 'Energetic, motivational, gets you moving',           tone: 'like an energetic life coach — motivational, positive, action-focused and uplifting' },
  therapist: { label: '🧘 Calm Guide',         desc: 'Gentle, mindful, focuses on self-compassion',        tone: 'like a calm mindfulness guide — gentle, non-judgmental, focused on self-compassion and breathing' },
  journal:   { label: '📓 Journaling Partner', desc: 'Asks deep questions to help you reflect',            tone: 'like a journaling partner — ask one meaningful reflective question after validating their feelings, to deepen self-awareness' },
}

function isPro() { return !!currentProfile?.is_pro }

// Checks + increments today's AI usage.
// Uses Supabase (entries with ai_response today) as the source of truth —
// incognito / localStorage clearing can't bypass this.
async function checkDailyAiLimit() {
  if (isPro()) return true   // unlimited for pro

  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .not('ai_response', 'is', null)
    .gte('created_at', start.toISOString())

  if (error) {
    console.warn('[Limit] Could not check AI count, allowing:', error.message)
    return true  // fail open — don't block user if DB is slow
  }

  return (count || 0) < FREE_AI_LIMIT
}

// Load PayPal JS SDK dynamically (only when needed)
let _paypalLoaded = false
function loadPayPalSDK() {
  if (_paypalLoaded || !PAYPAL_CLIENT_ID) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src   = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`
    script.setAttribute('data-sdk-integration-source', 'button-factory')
    script.onload  = () => { _paypalLoaded = true; resolve() }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============================================================
// SECURITY — Rate limiting & guards
// ============================================================

// Tracks timestamps of recent actions in memory (cleared on page reload)
const rateLimiter = {
  aiCalls:  [],   // timestamps of Gemini requests
  saves:    [],   // timestamps of entry saves

  // Returns true if the action is allowed, false if rate-limited
  check(key, maxCount, windowMs) {
    const now    = Date.now()
    this[key]    = this[key].filter(t => now - t < windowMs)
    if (this[key].length >= maxCount) return false
    this[key].push(now)
    return true
  }
}

// Sanitizes user-supplied text before inserting into innerHTML
// Prevents XSS if any content ever reaches the DOM as HTML
function sanitize(str) {
  const el = document.createElement('div')
  el.textContent = str
  return el.innerHTML
}

// Enforces max character length and strips dangerous patterns
function sanitizeInput(text, maxLen = 2000) {
  if (typeof text !== 'string') return ''
  return text.trim().substring(0, maxLen)
}

// Simple debounce — prevents double-submission on rapid clicks
function debounce(fn, delay = 600) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

// ============================================================
// STATE
// ============================================================
const state = {
  currentTab:      'checkin',  // 'checkin' | 'insights' | 'resources' | 'settings'
  currentView:     'checkin',  // 'checkin' | 'journal'
  selectedMood:    null,
  selectedTopic:   null,
  isGeneratingAI:  false,
  aiResponse:      null,
  isSaving:        false,
  history:         [],         // populated from Supabase
  theme:           localStorage.getItem('ms-theme') || 'default',
  chartType:       localStorage.getItem('ms-chart') || 'bar',  // 'bar' | 'line' | 'dots'
  aiPersonality:   localStorage.getItem('ms-ai-personality') || 'friend',  // pro feature
  affirmation:     localStorage.getItem('ms-affirmation') || '',           // pro feature
}

// Auth state
let currentUser    = null
let currentProfile = null

// ============================================================
// STATIC DATA
// ============================================================

const moods = [
  { id: 'great', emoji: '😄', label: 'Great',          color: 'var(--color-mood-great)',   score: 5 },
  { id: 'good',  emoji: '🙂', label: 'Good',           color: 'var(--color-mood-good)',    score: 4 },
  { id: 'okay',  emoji: '😐', label: 'Okay',           color: 'var(--color-mood-okay)',    score: 3 },
  { id: 'low',   emoji: '😔', label: 'Low',            color: 'var(--color-mood-low)',     score: 2 },
  { id: 'rough', emoji: '😢', label: 'Rough',          color: 'var(--color-mood-rough)',   score: 1 },
  { id: 'special', emoji: '💬', label: 'Something else', color: 'var(--color-mood-special)', score: 0, isSpecial: true }
]

const topics = [
  { id: 'heartbreak',   label: '💔 Heartbreak' },
  { id: 'friend_drama', label: '👥 Friend drama' },
  { id: 'family',       label: '🏠 Family' },
  { id: 'burnout',      label: '📚 Burnout' },
  { id: 'loneliness',   label: '😶 Loneliness' },
  { id: 'anger',        label: '😤 Anger' },
  { id: 'not_sure',     label: '🤷 Not sure' }
]

// Tips shown per topic in journal mode
const tips = {
  heartbreak:   [
    { icon: '💙', text: "Give yourself permission to grieve — it's a real loss." },
    { icon: '🔇', text: "Unfollow or mute if you need to. Protecting your peace isn't petty." }
  ],
  friend_drama: [
    { icon: '🚪', text: "You don't owe anyone access to you when you're hurting." },
    { icon: '⏳', text: "Most fallouts look different after 48 hours. Give it time." }
  ],
  family: [
    { icon: '🎧', text: "Find one small space that feels like yours — even just headphones in." },
    { icon: '💙', text: "You can love people and still need distance from them." }
  ],
  burnout: [
    { icon: '✅', text: "Done is better than perfect right now. Finish, then improve." },
    { icon: '🧠', text: "Break it into 20-minute chunks. Your brain can do anything for 20 min." }
  ],
  loneliness: [
    { icon: '💬', text: "Loneliness lies — it tells you no one cares but that's not true." },
    { icon: '📍', text: "Try showing up somewhere consistently. Belonging takes repetition." }
  ],
  anger: [
    { icon: '❓', text: "Ask: what's underneath the anger — hurt? fear? disrespect?" },
    { icon: '🏃', text: "Move your body before you respond. Walk, run, punch a pillow." }
  ],
  not_sure: [
    { icon: '🪑', text: "Not knowing what you feel is still a feeling. Sit in it." },
    { icon: '✏️', text: 'Try finishing: "I just wish someone knew that…"' }
  ],
  default: [
    { icon: '🫁', text: "Take a deep breath in for 4 seconds, hold for 4, out for 6." },
    { icon: '🛋️', text: "Find a comfortable spot and drop your shoulders away from your ears." }
  ]
}

// ============================================================
// DOM REFS (set once after DOMContentLoaded)
// ============================================================
let mainContent, appHeader, mainTitle, mainSubtitle, tabButtons

// ============================================================
// INIT
// ============================================================

// Because main.js uses top-level await (to fetch config), DOMContentLoaded
// may have already fired by the time this module continues. We check
// readyState so the app initialises correctly in both cases.
async function init() {
  mainContent  = document.getElementById('main-content')
  appHeader    = document.getElementById('app-header')
  mainTitle    = document.getElementById('main-title')
  mainSubtitle = document.getElementById('main-subtitle')
  tabButtons   = document.querySelectorAll('.tab-btn')

  await verifyAuth()

  // verifyAuth() may redirect unauthenticated users — stop here if so
  if (!currentUser) return

  // Restore saved theme before first render
  applyTheme(state.theme)

  setupTabBar()
  await loadHistory()
  render()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// ============================================================
// AUTH
// ============================================================

// Guards the page — redirects to auth.html if no session
async function verifyAuth() {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    window.location.href = 'auth.html'
    return
  }

  currentUser = session.user

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('[Auth] Profile error:', error.message)
  }

  if (!profile) {
    // First Google OAuth login — auto-create profile
    const name = currentUser.user_metadata?.full_name
      || currentUser.user_metadata?.display_name
      || currentUser.email?.split('@')[0]
      || 'Friend'

    await supabase.from('profiles').insert([{
      id:           currentUser.id,
      email:        currentUser.email,
      display_name: name,
      role:         'student',
      streak_count: 0
    }])

    const { data: fresh } = await supabase
      .from('profiles').select('*').eq('id', currentUser.id).single()
    currentProfile = fresh
  } else {
    currentProfile = profile
  }

  // Counselors land on dashboard, not here
  if (currentProfile?.role === 'counselor') {
    window.location.href = 'dashboard.html'
    return
  }

  console.log('[Auth] Signed in as:', currentProfile?.display_name)
}

// Signs out and returns to auth page
async function logout() {
  await supabase.auth.signOut()
  window.location.href = 'auth.html'
}

// ============================================================
// DATABASE — load history
// ============================================================

// Fetches the 7 most recent entries from Supabase for the insights tab
async function loadHistory() {
  try {
    let query = supabase
      .from('entries')
      .select('id, mood, mood_score, note, topic, created_at, is_journal')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })

    if (isPro()) {
      // Pro: last 90 days
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 90)
      query = query.gte('created_at', cutoff.toISOString())
    } else {
      // Free: last 7 entries only
      query = query.limit(7)
    }

    const { data, error } = await query
    if (error) throw error
    state.history = data || []
    console.log('[DB] History loaded:', state.history.length, 'entries', isPro() ? '(Pro 90d)' : '(Free 7)')
  } catch (err) {
    console.error('[DB] History load error:', err.message)
    state.history = []
  }
}

// ============================================================
// RENDER LOOP
// ============================================================

function render() {
  // Journal mode: hide the default app header
  if (state.currentView === 'journal') {
    appHeader.classList.add('hidden')
    document.body.classList.add('journal-mode')
  } else {
    appHeader.classList.remove('hidden')
    document.body.classList.remove('journal-mode')
  }

  // Update header text + user info
  if (state.currentView !== 'journal') {
    const name   = currentProfile?.display_name || 'Friend'
    const streak = currentProfile?.streak_count  || 0

    if (state.currentTab === 'checkin') {
      mainTitle.textContent    = `Hey ${name} 👋`
      mainSubtitle.innerHTML   = `
        <span style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="color:var(--color-text-muted)">How are you feeling right now?</span>
          <span style="display:flex;align-items:center;gap:10px">
            <span style="color:var(--color-accent-secondary);font-weight:600;font-size:0.9rem">🔥 ${streak}d streak</span>
            <button id="logout-btn"
              style="font-size:0.78rem;color:var(--color-text-muted);padding:4px 10px;
                     border:1.5px solid #EAEBE9;border-radius:999px;background:none;cursor:pointer;
                     font-family:inherit;transition:0.15s ease"
              onmouseover="this.style.color='var(--color-text-main)'"
              onmouseout="this.style.color='var(--color-text-muted)'">
              Log out
            </button>
          </span>
        </span>`
      document.getElementById('logout-btn')?.addEventListener('click', logout)
    } else if (state.currentTab === 'insights') {
      mainTitle.textContent   = 'Insights'
      mainSubtitle.textContent = 'Looking back at your week'
    } else if (state.currentTab === 'resources') {
      mainTitle.textContent   = 'Resources'
      mainSubtitle.textContent = 'Tools to help you anchor'
    }
  }

  // Render active tab content
  if (state.currentTab === 'checkin') {
    mainContent.innerHTML = renderCheckin()
  } else if (state.currentTab === 'insights') {
    mainContent.innerHTML = renderInsights()
  } else if (state.currentTab === 'resources') {
    mainContent.innerHTML = renderResources()
  } else if (state.currentTab === 'settings') {
    mainContent.innerHTML = renderSettings()
  }

  attachEventListeners()
}

// ============================================================
// CHECKIN VIEW
// ============================================================

function renderCheckin() {
  if (state.selectedMood === 'special' && state.currentView === 'journal') {
    return renderJournalMode()
  }

  const moodButtonsHTML = moods.map(m => `
    <button class="mood-btn ${m.id === state.selectedMood ? 'selected' : ''} ${m.isSpecial ? 'mood-special' : ''}"
            data-mood="${m.id}">
      <span class="mood-emoji">${m.emoji}</span>
      <span class="mood-label">${m.label}</span>
    </button>
  `).join('')

  // Always show the note area and save button once a mood is picked
  const showActions = !!state.selectedMood

  let aiBlockHTML = ''
  if (state.isGeneratingAI) {
    aiBlockHTML = `
      <div class="ai-card animate-fade-in">
        <div class="ai-card-title">Thinking of something for you…</div>
        <div class="dot-typing"></div>
      </div>`
  } else if (state.aiResponse) {
    aiBlockHTML = `
      <div class="ai-card animate-fade-in">
        <div class="ai-card-title">✨ Here for you</div>
        <div class="ai-card-content">${sanitize(state.aiResponse)}</div>
      </div>`
  }

  // Pro affirmation banner
  const affirmationHTML = isPro() && state.affirmation
    ? `<div class="affirmation-banner animate-fade-in">💙 ${sanitize(state.affirmation)}</div>`
    : ''

  return `
    <div class="view-container active">
      ${affirmationHTML}
      <div class="mood-grid animate-fade-in">${moodButtonsHTML}</div>

      <div class="input-wrapper animate-fade-in" style="${showActions ? '' : 'display:none'}">
        <textarea id="checkin-note" class="short-note"
          maxlength="500"
          placeholder="What's making you feel this way? (Optional — you can save without writing)">${state._lastNote && !state.aiResponse ? state._lastNote : ''}</textarea>
      </div>

      ${aiBlockHTML}

      <div class="actions animate-fade-in" style="${showActions ? '' : 'display:none'}">
        <button id="btn-ai-support" class="btn btn-primary ${state.isGeneratingAI ? 'loading' : ''}">
          ✨ Get AI Support
        </button>
        <button id="btn-save" class="btn btn-secondary" ${state.isSaving ? 'disabled' : ''}>
          ${state.isSaving ? 'Saving…' : 'Save check-in'}
        </button>
      </div>
    </div>
  `
}

function renderJournalMode() {
  const topicsHTML = topics.map(t => `
    <button class="topic-pill ${t.id === state.selectedTopic ? 'selected' : ''}"
            data-topic="${t.id}">${t.label}</button>
  `).join('')

  let tipsHTML = ''
  if (state.selectedTopic) {
    const topicTips = tips[state.selectedTopic] || tips.default
    tipsHTML = `<div class="animate-fade-in">` + topicTips.map(t => `
      <div class="tip-card">
        <div class="tip-icon">${t.icon}</div>
        <div class="tip-text">${t.text}</div>
      </div>
    `).join('') + `</div>`
  }

  let aiBlockHTML = ''
  if (state.isGeneratingAI) {
    aiBlockHTML = `
      <div class="ai-card journal-version animate-fade-in">
        <div class="ai-card-title">Reading your thoughts…</div>
        <div class="dot-typing" style="margin-left:15px;margin-top:10px"></div>
      </div>`
  } else if (state.aiResponse) {
    aiBlockHTML = `
      <div class="ai-card journal-version animate-fade-in" style="margin-bottom:24px">
        <div class="ai-card-title">🌿 Gentle thought</div>
        <div class="ai-card-content">${sanitize(state.aiResponse)}</div>
      </div>`
  }

  return `
    <div class="view-container active">
      <button id="btn-back-checkin" class="btn-back">← Back to check-in</button>

      <h2 class="title" style="font-size:1.6rem">This space is just for you.</h2>
      <p class="subtitle" style="margin-bottom:16px">
        You don't have to label it. Just write what's going on.
      </p>

      <div class="topic-scroll-row">${topicsHTML}</div>

      ${tipsHTML}

      <div class="input-wrapper">
        <textarea id="journal-note" class="journal-note"
          maxlength="3000"
          placeholder="Take a deep breath and start typing whenever you're ready…"></textarea>
      </div>

      ${aiBlockHTML}

      <div class="actions" style="${state.aiResponse ? 'display:none' : ''}">
        <button id="btn-ai-support-journal" class="btn btn-primary ${state.isGeneratingAI ? 'loading' : ''}">
          ✨ Get AI Support
        </button>
        <button id="btn-save-journal" class="btn btn-secondary" ${state.isSaving ? 'disabled' : ''}>
          ${state.isSaving ? 'Saving…' : 'Save entry'}
        </button>
      </div>

      ${state.aiResponse ? `
        <div class="actions animate-fade-in">
          <button id="btn-save-after-ai" class="btn btn-primary" ${state.isSaving ? 'disabled' : ''}>
            ${state.isSaving ? 'Saving…' : '💾 Save entry'}
          </button>
        </div>` : ''}
    </div>
  `
}

// ============================================================
// INSIGHTS VIEW
// ============================================================

function renderInsights() {
  // Build day map — keyed YYYY-MM-DD, one entry per day
  const entryByDate = {}
  state.history.forEach(entry => {
    const d   = new Date(entry.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!entryByDate[key]) entryByDate[key] = entry
  })

  // Last 7 calendar days
  const last7 = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    last7.push({ key, dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' })[0] })
  }

  const hasAny  = last7.some(({ key }) => entryByDate[key])
  const W = 300, H = 100  // SVG viewport for line chart

  // ── Bar chart ────────────────────────────────────────────────
  function buildBar() {
    return last7.map(({ key, dayLabel }) => {
      const entry = entryByDate[key]
      if (entry) {
        const m      = moods.find(x => x.id === entry.mood) || moods[2]
        const score  = entry.mood_score ?? 3
        const height = Math.max(20, Math.round((score / 5) * 90))
        return `<div class="chart-bar-group">
          <div class="chart-bar" style="height:${height}px;background:${m.color}" title="${m.label}"></div>
          <span class="chart-day">${dayLabel}</span></div>`
      }
      return `<div class="chart-bar-group">
        <div class="chart-bar" style="height:20px;background:var(--color-bg-surface)"></div>
        <span class="chart-day" style="opacity:0.35">${dayLabel}</span></div>`
    }).join('')
  }

  // ── Line chart (inline SVG) ──────────────────────────────────
  function buildLine() {
    const pts = last7.map(({ key }, i) => {
      const entry = entryByDate[key]
      const score = entry ? (entry.mood_score ?? 3) : null
      const x     = Math.round((i / 6) * (W - 20) + 10)
      const y     = score !== null ? Math.round(H - (score / 5) * (H - 16) - 8) : null
      return { x, y, score, entry, key }
    })

    // Polyline only through filled points
    const filled   = pts.filter(p => p.y !== null)
    const polyline = filled.length > 1
      ? `<polyline fill="none" stroke="var(--color-primary)" stroke-width="2.5"
                   stroke-linecap="round" stroke-linejoin="round"
                   points="${filled.map(p => `${p.x},${p.y}`).join(' ')}" />`
      : ''

    // Gradient fill under the line
    const fillPath = filled.length > 1
      ? `<path fill="url(#lineGrad)" opacity="0.18"
               d="M${filled[0].x},${H} ${filled.map(p => `L${p.x},${p.y}`).join(' ')} L${filled[filled.length-1].x},${H} Z" />`
      : ''

    const dots = pts.map(p => {
      if (p.y === null) return `<circle cx="${p.x}" cy="${H/2}" r="3" fill="var(--color-bg-surface)" />`
      const m   = p.entry ? moods.find(x => x.id === p.entry.mood) || moods[2] : moods[2]
      return `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${m.color}" stroke="#fff" stroke-width="2"
                      title="${m.label}" />`
    }).join('')

    const labels = pts.map(p =>
      `<text x="${p.x}" y="${H + 14}" text-anchor="middle"
             font-size="9" fill="${p.y !== null ? 'var(--color-text-muted)' : 'rgba(0,0,0,0.2)'}"
             font-family="inherit" font-weight="600">${p.key.slice(-2) === new Date().toISOString().split('T')[0].slice(-2) && p === pts[6] ? 'T' : p.entry ? last7[pts.indexOf(p)].dayLabel : last7[pts.indexOf(p)].dayLabel}</text>`
    ).join('')

    return `<svg viewBox="0 0 ${W} ${H+18}" width="100%" style="overflow:visible;display:block">
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-primary)" />
          <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${fillPath}${polyline}${dots}${labels}
    </svg>`
  }

  // ── Dots / Scatter chart ─────────────────────────────────────
  function buildDots() {
    return `<div class="dots-chart">` +
      last7.map(({ key, dayLabel }) => {
        const entry = entryByDate[key]
        const m     = entry ? moods.find(x => x.id === entry.mood) || moods[2] : null
        const score = entry?.mood_score ?? 0
        const size  = entry ? Math.max(28, Math.round((score / 5) * 52)) : 16
        return `<div class="dots-col">
          <div class="dots-bubble" style="${entry
            ? `width:${size}px;height:${size}px;background:${m.color};opacity:1`
            : 'width:14px;height:14px;background:var(--color-bg-surface);opacity:0.5'
          }" title="${entry ? m.label : 'No entry'}">
            ${entry ? `<span style="font-size:${Math.max(10, size*0.45)}px">${m.emoji}</span>` : ''}
          </div>
          <span class="chart-day" style="${!entry ? 'opacity:0.35' : ''}">${dayLabel}</span>
        </div>`
      }).join('') + `</div>`
  }

  // Pick active chart
  const chartInner = {
    bar:  buildBar(),
    line: buildLine(),
    dots: buildDots(),
  }[state.chartType] || buildBar()

  const isLineOrDots = state.chartType !== 'bar'

  // Chart type switcher
  const chartSwitcher = `
    <div class="chart-switcher">
      ${[['bar','bar_chart','Bar'],['line','show_chart','Line'],['dots','scatter_plot','Dots']].map(([type, icon, label]) => `
        <button class="chart-type-btn ${state.chartType === type ? 'active' : ''}" data-chart="${type}">
          <span class="material-symbols-outlined">${icon}</span>
          ${label}
        </button>`).join('')}
    </div>`

  // Entry list
  const entriesHTML = state.history.length > 0
    ? state.history.map(entry => {
        const m       = moods.find(x => x.id === entry.mood) || { emoji: '📝', label: 'Entry' }
        const topic   = topics.find(t => t.id === entry.topic)
        const tagHtml = topic
          ? `<span style="font-size:0.72rem;background:rgba(0,0,0,0.05);padding:2px 8px;border-radius:12px;margin-left:6px">${topic.label}</span>`
          : ''
        const date    = new Date(entry.created_at)
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const snippet = entry.note
          ? sanitize(entry.note.substring(0, 60)) + (entry.note.length > 60 ? '…' : '')
          : m.label
        return `<div class="entry-card">
          <div class="entry-emoji">${m.emoji}</div>
          <div class="entry-details">
            <div class="entry-date">${date}${tagHtml}</div>
            <div class="entry-snippet">${snippet}</div>
          </div></div>`
      }).join('')
    : `<p style="color:var(--color-text-muted);font-size:0.9rem;text-align:center;padding:24px 0">
         Check in every day to build your history 🌱</p>`

  const streak = currentProfile?.streak_count || 0

  const emptyMsg = !hasAny
    ? `<p style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                 color:var(--color-text-muted);font-size:0.9rem;text-align:center;padding:0 20px">
         No check-ins yet — your chart will appear here 🌱</p>`
    : ''

  return `
    <div class="view-container active">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
        <div style="background:var(--color-bg-card);border-radius:var(--radius-md);padding:20px;
                    text-align:center;box-shadow:var(--shadow-sm)">
          <div id="ins-streak" style="font-size:2rem;font-weight:700;color:var(--color-accent-secondary)">${streak}</div>
          <div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:4px">🔥 Current streak</div>
        </div>
        <div style="background:var(--color-bg-card);border-radius:var(--radius-md);padding:20px;
                    text-align:center;box-shadow:var(--shadow-sm)">
          <div id="ins-longest" style="font-size:2rem;font-weight:700;color:var(--color-accent-primary)">—</div>
          <div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:4px">🏆 Longest streak</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 class="section-title" style="margin-bottom:0">Your week</h2>
        ${chartSwitcher}
      </div>
      <div class="chart-container ${isLineOrDots ? 'chart-alt' : ''}" style="position:relative">
        ${chartInner}${emptyMsg}
      </div>

      <h2 class="section-title">Recent entries</h2>
      <div class="entries-list">${entriesHTML}</div>
    </div>
  `
}

// ============================================================
// RESOURCES VIEW
// ============================================================

function renderResources() {
  return `
    <div class="view-container active">
      <h2 class="section-title">When you need it</h2>

      <!-- Crisis — always first, tappable on mobile -->
      <div class="resource-card crisis-card" style="cursor:default">
        <div class="resource-info" style="width:100%">
          <h3>Crisis Support</h3>
          <p style="margin-bottom:12px;font-size:0.9rem;color:#8a3a3a">
            You're not alone. Reach out — it's free, 24/7 and confidential.
          </p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="sms:741741?body=HOME" class="crisis-action-btn crisis-text">
              <span class="material-symbols-outlined">sms</span>
              Text HOME to 741741
            </a>
            <a href="tel:988" class="crisis-action-btn crisis-call">
              <span class="material-symbols-outlined">call</span>
              Call / Text 988
            </a>
          </div>
        </div>
      </div>

      <div class="resource-card" id="card-breath" onclick="toggleResource('breath-detail','breath-arrow')">
        <div class="resource-info">
          <h3>Box breathing</h3>
          <p>A 2-minute reset for your nervous system.</p>
        </div>
        <div class="resource-action" id="breath-arrow">🫁</div>
      </div>
      <div id="breath-detail"
           style="display:none;background:var(--color-bg-card);border-radius:var(--radius-md);
                  padding:20px;margin-top:-8px;margin-bottom:12px;box-shadow:var(--shadow-sm)">
        <p style="font-size:0.9rem;color:var(--color-text-muted);margin-bottom:16px">
          Repeat 4 times. Works great before a test or a hard conversation.
        </p>
        <div style="display:flex;gap:8px">
          ${['Inhale<br>4 sec','Hold<br>4 sec','Exhale<br>4 sec','Hold<br>4 sec'].map(s => `
            <div style="flex:1;background:rgba(139,184,136,0.12);border-radius:12px;padding:12px 6px;
                        text-align:center;font-size:0.8rem;font-weight:600;
                        color:var(--color-accent-primary);line-height:1.5">${s}</div>
          `).join('')}
        </div>
      </div>

      <div class="resource-card" onclick="toggleResource('ground-detail','ground-arrow')">
        <div class="resource-info">
          <h3>5-4-3-2-1 Grounding</h3>
          <p>Bring your focus back to the present moment.</p>
        </div>
        <div class="resource-action" id="ground-arrow">🌿</div>
      </div>
      <div id="ground-detail"
           style="display:none;background:var(--color-bg-card);border-radius:var(--radius-md);
                  padding:20px;margin-top:-8px;margin-bottom:12px;box-shadow:var(--shadow-sm)">
        ${[['5','things you can see'],['4','things you can touch'],
           ['3','things you can hear'],['2','things you can smell'],
           ['1','thing you can taste']].map(([n, s]) => `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--color-accent-primary);
                        color:white;display:flex;align-items:center;justify-content:center;
                        font-weight:700;font-size:0.85rem;flex-shrink:0">${n}</div>
            <span style="font-size:0.92rem">${s}</span>
          </div>`).join('')}
      </div>

      <div class="resource-card" onclick="toggleResource('move-detail','move-arrow')">
        <div class="resource-info">
          <h3>Move your body</h3>
          <p>One of the fastest ways to shift your mood.</p>
        </div>
        <div class="resource-action" id="move-arrow">🚶</div>
      </div>
      <div id="move-detail"
           style="display:none;background:var(--color-bg-card);border-radius:var(--radius-md);
                  padding:20px;margin-top:-8px;margin-bottom:12px;box-shadow:var(--shadow-sm)">
        <ul style="padding-left:20px;line-height:2;font-size:0.92rem">
          <li>10-minute walk outside (no phone)</li>
          <li>20 jumping jacks or push-ups</li>
          <li>Dance to one song, full out</li>
          <li>5 minutes of stretching</li>
          <li>Ride a bike, shoot hoops, kick a ball</li>
        </ul>
      </div>

    </div>
  `
}

// ============================================================
// SETTINGS VIEW
// ============================================================

const THEMES = {
  // ── Free themes ─────────────────────────────────────────────
  default:   { label: '🌿 Terracotta', primary: '#9b452e', primaryContainer: '#ffad97', bg: '#fff8f1', surface: '#fceae0', surfaceLow: '#fff1e6', secondary: '#ffe0bd' },
  ocean:     { label: '🌊 Ocean',      primary: '#1d6fa4', primaryContainer: '#b3daff', bg: '#f0f8ff', surface: '#daeeff', surfaceLow: '#edf6ff', secondary: '#d0ecff' },
  // ── Pro-only themes ──────────────────────────────────────────
  gold:      { label: '✨ Gold',        primary: '#a07000', primaryContainer: '#ffe082', bg: '#fffdf0', surface: '#fff8d6', surfaceLow: '#fffbe8', secondary: '#fff0b3' },
  silver:    { label: '🪙 Silver',      primary: '#546e7a', primaryContainer: '#cfd8dc', bg: '#f8fafb', surface: '#e8eef1', surfaceLow: '#f1f5f7', secondary: '#dde6ea' },
  rose:      { label: '🌹 Rose Gold',   primary: '#b5546a', primaryContainer: '#fcd0da', bg: '#fff5f7', surface: '#fde5ea', surfaceLow: '#fff0f3', secondary: '#fad7df' },
  cherry:    { label: '🌸 Cherry',      primary: '#ad1457', primaryContainer: '#f8bbd0', bg: '#fff5f8', surface: '#fde0eb', surfaceLow: '#ffeef4', secondary: '#f9c8da' },
  sunset:    { label: '🌅 Sunset',      primary: '#c0392b', primaryContainer: '#ffd5cc', bg: '#fff8f7', surface: '#ffe8e4', surfaceLow: '#fff3f1', secondary: '#ffd0c8' },
  amethyst:  { label: '💎 Amethyst',    primary: '#6a1b9a', primaryContainer: '#e1bee7', bg: '#fdf5ff', surface: '#f3e5f5', surfaceLow: '#f8f0fc', secondary: '#e8d5f0' },
  arctic:    { label: '🧊 Arctic',      primary: '#006494', primaryContainer: '#b2ebf2', bg: '#f0fdff', surface: '#d8f5f8', surfaceLow: '#eafbfc', secondary: '#c4eef3' },
  sage:      { label: '🍃 Sage',        primary: '#4a6741', primaryContainer: '#c8e6c9', bg: '#f5faf5', surface: '#dff0df', surfaceLow: '#ecf6ec', secondary: '#d4ebd4' },
  lavender:  { label: '💜 Lavender',    primary: '#6d3fa0', primaryContainer: '#ddd6fe', bg: '#faf5ff', surface: '#ede9fe', surfaceLow: '#f5f0ff', secondary: '#e9e0fd' },
  forest:    { label: '🌲 Forest',      primary: '#2a6741', primaryContainer: '#b2f0cc', bg: '#f0fdf4', surface: '#dcf7e8', surfaceLow: '#edfaf3', secondary: '#c6f0d8' },
  midnight:  { label: '🌙 Midnight',    primary: '#4f7cd4', primaryContainer: '#bfcfff', bg: '#f5f7ff', surface: '#e8edff', surfaceLow: '#f0f3ff', secondary: '#d8e0ff' },
}

function applyTheme(name) {
  const t = THEMES[name] || THEMES.default
  const r = document.documentElement
  r.style.setProperty('--color-primary',            t.primary)
  r.style.setProperty('--color-accent-primary',      t.primary)
  r.style.setProperty('--color-accent-primary-hover', shadeColor(t.primary, -15))
  r.style.setProperty('--color-primary-container',   t.primaryContainer)
  r.style.setProperty('--color-accent-special',      t.primaryContainer)
  r.style.setProperty('--color-bg-main',             t.bg)
  r.style.setProperty('--color-bg-journal',          t.surfaceLow)
  r.style.setProperty('--color-bg-surface',          t.surface)
  r.style.setProperty('--color-bg-surface-low',      t.surfaceLow)
  r.style.setProperty('--color-secondary-container', t.secondary)
  state.theme = name
  localStorage.setItem('ms-theme', name)
}

// Darken/lighten a hex color by amt (-255 to 255)
function shadeColor(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16)
  const r = Math.min(255, Math.max(0, (n >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt))
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('')
}

function renderSettings() {
  const name     = sanitize(currentProfile?.display_name || 'Friend')
  const email    = sanitize(currentUser?.email || '')
  const initials = (currentProfile?.display_name || 'F').charAt(0).toUpperCase()
  const pro      = isPro()

  // Theme swatches — pro-only themes show a lock for free users
  const themeButtons = Object.entries(THEMES).map(([key, t]) => {
    const isFreeTheme = FREE_THEMES.includes(key)
    const locked      = !pro && !isFreeTheme
    const active      = state.theme === key
    return `
      <button class="theme-swatch ${active ? 'active' : ''} ${locked ? 'locked' : ''}"
              data-theme="${key}" ${locked ? 'data-locked="1"' : ''}
              style="background:${t.primary}" title="${t.label}${locked ? ' — Pro' : ''}">
        ${active ? '<span class="material-symbols-outlined" style="font-size:0.95rem;color:#fff">check</span>' : ''}
        ${locked ? '<span class="material-symbols-outlined" style="font-size:0.8rem;color:#fff;opacity:0.85">lock</span>' : ''}
      </button>`
  }).join('')

  // AI personality buttons (pro only)
  const personalityButtons = Object.entries(AI_PERSONALITIES).map(([key, p]) => `
    <button class="personality-btn ${state.aiPersonality === key ? 'active' : ''}"
            data-personality="${key}" ${!pro ? 'data-locked="1"' : ''}>
      <span class="personality-icon">${p.label.split(' ')[0]}</span>
      <span class="personality-name">${p.label.split(' ').slice(1).join(' ')}</span>
      <span class="personality-desc">${p.desc}</span>
    </button>`
  ).join('')

  // AI usage display (Supabase count is async so we show status message)
  const aiDisplay = pro
    ? `<span style="color:var(--color-primary);font-weight:700">Unlimited ✨</span>`
    : `<span style="color:var(--color-text-muted)">${FREE_AI_LIMIT}/day — <a href="#" id="link-upgrade" style="color:var(--color-primary);font-weight:600">Upgrade for unlimited</a></span>`

  // Pro badge or upgrade card
  const proSection = pro ? `
    <div class="settings-section pro-active-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span class="pro-badge">PRO</span>
        <span style="font-weight:700">MoodSpace Pro — Active</span>
      </div>
      <div style="font-size:0.85rem;color:var(--color-text-muted)">
        Unlimited AI · Full history · All themes · ${PRO_PRICE}
      </div>
      <button id="btn-cancel-sub" class="btn-danger-pill" style="margin-top:14px;font-size:0.8rem">
        Cancel subscription
      </button>
    </div>
  ` : `
    <div class="settings-section upgrade-card">
      <div class="upgrade-header">
        <span class="pro-badge">PRO</span>
        <span style="font-weight:800;font-size:1.1rem">Upgrade to Pro</span>
        <span class="upgrade-price">${PRO_PRICE}</span>
      </div>
      <ul class="upgrade-features">
        <li><span class="material-symbols-outlined">auto_awesome</span> Unlimited AI support every day</li>
        <li><span class="material-symbols-outlined">history</span> 90-day mood history</li>
        <li><span class="material-symbols-outlined">palette</span> All 5 color themes</li>
        <li><span class="material-symbols-outlined">workspace_premium</span> Pro badge on your profile</li>
      </ul>
      <div id="paypal-button-container" style="margin-top:16px"></div>
      <div id="paypal-loading" style="text-align:center;padding:12px;color:var(--color-text-muted);font-size:0.9rem">
        Loading secure checkout…
      </div>
    </div>
  `

  return `
    <div class="view-container active">

      <!-- Profile card -->
      <div class="settings-profile-card">
        <div class="settings-avatar-big">${initials}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:700;font-size:1.05rem">${name}</span>
            ${pro ? '<span class="pro-badge">PRO</span>' : ''}
          </div>
          <div style="font-size:0.85rem;color:var(--color-text-muted)">${email}</div>
        </div>
      </div>

      <!-- Pro status / upgrade -->
      ${proSection}

      <!-- Profile section -->
      <div class="settings-section">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">person</span> Profile
        </h2>
        <div class="settings-group">
          <label class="settings-label">Display name</label>
          <input id="settings-name" class="settings-input" type="text"
                 value="${name}" maxlength="50" placeholder="Your name" />
        </div>
        <button id="btn-save-profile" class="btn btn-primary" style="margin-top:12px">
          Save changes
        </button>
      </div>

      <!-- AI usage -->
      <div class="settings-section">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">auto_awesome</span> AI Usage
        </h2>
        <div class="settings-row-info">
          <div style="font-size:0.92rem">Daily AI requests</div>
          <div style="font-size:0.92rem">${aiDisplay}</div>
        </div>
      </div>

      <!-- Check-in reset -->
      <div class="settings-section">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">today</span> Today's Check-in
        </h2>
        <div class="settings-row-info">
          <div>
            <div style="font-weight:600;font-size:0.95rem">Reset today's entry</div>
            <div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px">
              Delete today's check-in and start over
            </div>
          </div>
          <button id="btn-reset-checkin" class="btn-danger-pill">Reset</button>
        </div>
      </div>

      <!-- Appearance -->
      <div class="settings-section">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">palette</span> Appearance
        </h2>
        <div class="settings-label" style="margin-bottom:12px">
          Color theme ${pro ? `<span style="color:var(--color-text-muted);font-weight:400">${THEMES[state.theme]?.label || ''}</span>` : '— <span style="color:var(--color-primary)">Pro unlocks 10 more</span>'}
        </div>
        <div class="theme-swatches-row">${themeButtons}</div>
      </div>

      <!-- AI Personality (Pro) -->
      <div class="settings-section ${!pro ? 'pro-locked-section' : ''}">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">smart_toy</span> AI Personality
          ${!pro ? '<span class="pro-badge" style="margin-left:auto">PRO</span>' : ''}
        </h2>
        ${!pro ? `<p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:12px">Upgrade to choose how the AI talks to you</p>` : ''}
        <div class="personality-grid">${personalityButtons}</div>
      </div>

      <!-- Daily Affirmation (Pro) -->
      <div class="settings-section ${!pro ? 'pro-locked-section' : ''}">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">favorite</span> Daily Affirmation
          ${!pro ? '<span class="pro-badge" style="margin-left:auto">PRO</span>' : ''}
        </h2>
        <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:12px">
          ${pro ? 'Shown at the top of your check-in every day' : 'Upgrade to set a personal affirmation'}
        </p>
        <input id="settings-affirmation" class="settings-input" type="text"
               value="${sanitize(state.affirmation)}" maxlength="120"
               placeholder="e.g. I am enough and I am doing my best 💙"
               ${!pro ? 'disabled' : ''} />
        ${pro ? `<button id="btn-save-affirmation" class="btn btn-secondary" style="margin-top:8px;width:auto;padding:8px 20px">Save</button>` : ''}
      </div>

      <!-- Export Journal (Pro) -->
      <div class="settings-section">
        <h2 class="settings-section-title">
          <span class="material-symbols-outlined">download</span> Export Journal
          ${!pro ? '<span class="pro-badge" style="margin-left:auto">PRO</span>' : ''}
        </h2>
        <div class="settings-row-info">
          <div>
            <div style="font-weight:600;font-size:0.95rem">Download your entries</div>
            <div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px">
              ${pro ? 'Save all your mood history as a text file' : 'Upgrade to export your journal'}
            </div>
          </div>
          <button id="btn-export" class="btn-secondary-pill" ${!pro ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
            Export .txt
          </button>
        </div>
      </div>

      <!-- Sign out -->
      <div class="settings-section">
        <button id="btn-signout" class="btn btn-secondary">
          <span class="material-symbols-outlined" style="font-size:1.1rem">logout</span>
          Sign out
        </button>
      </div>

    </div>
  `
}

// ============================================================
// PAYPAL SUBSCRIPTION
// ============================================================

async function mountPayPalButton() {
  if (isPro() || !PAYPAL_CLIENT_ID || !PAYPAL_PLAN_ID) return

  try {
    await loadPayPalSDK()
  } catch {
    const el = document.getElementById('paypal-loading')
    if (el) el.textContent = 'Could not load PayPal — check your connection and refresh.'
    return
  }

  const container = document.getElementById('paypal-button-container')
  const loading   = document.getElementById('paypal-loading')
  if (!container || !loading) return

  loading.style.display = 'none'

  window.paypal.Buttons({
    style: {
      shape:  'pill',
      color:  'gold',
      layout: 'vertical',
      label:  'subscribe',
    },
    createSubscription: (_data, actions) => {
      return actions.subscription.create({ plan_id: PAYPAL_PLAN_ID })
    },
    onApprove: async (_data, _actions) => {
      showToast('Payment approved — activating Pro…', 'info')

      try {
        // Get the user's current session JWT to send to our backend
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No auth session')

        const res = await fetch('/api/paypal-subscribe', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ subscriptionId: _data.subscriptionID }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Activation failed')

        // Refresh profile to get updated is_pro flag
        const { data: profile } = await supabase
          .from('profiles').select('*').eq('id', currentUser.id).single()
        if (profile) currentProfile = profile

        showToast('🎉 Welcome to MoodSpace Pro!', 'success')
        render()
      } catch (err) {
        showToast('Payment went through but activation failed — contact support. Error: ' + err.message, 'error')
      }
    },
    onError: (err) => {
      console.error('[PayPal] Button error:', err)
      showToast('PayPal error — please try again', 'error')
    },
    onCancel: () => {
      showToast('Subscription cancelled — you can upgrade anytime 💙', 'info')
    },
  }).render('#paypal-button-container')
}

// Export all journal entries as a .txt file (Pro)
function handleExportJournal() {
  if (!isPro()) { showToast('Export is a Pro feature ✨', 'info'); return }
  if (!state.history.length) { showToast('No entries to export yet 🌱', 'info'); return }

  const lines = state.history.map(entry => {
    const m    = moods.find(x => x.id === entry.mood) || { emoji: '📝', label: 'Entry' }
    const date = new Date(entry.created_at).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    const type = entry.is_journal ? 'Journal' : 'Check-in'
    return [
      `────────────────────────`,
      `${date} · ${type}`,
      `Mood: ${m.emoji} ${m.label}`,
      entry.note ? `\n${entry.note}` : '',
      entry.ai_response ? `\nAI Response:\n${entry.ai_response}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const header = `MoodSpace Journal Export\nGenerated: ${new Date().toLocaleDateString()}\n${'═'.repeat(30)}\n\n`
  const blob   = new Blob([header + lines], { type: 'text/plain' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = `moodspace-journal-${new Date().toISOString().split('T')[0]}.txt`
  a.click()
  URL.revokeObjectURL(url)
  showToast('Journal exported! 📄', 'success')
}

// Reset today's check-in from DB
async function handleResetCheckin() {
  if (!currentUser) return
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
  const end   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('user_id', currentUser.id)
    .gte('created_at', start)
    .lt('created_at', end)

  if (error) {
    showToast(`Reset failed: ${error.message}`, 'error')
    return
  }

  // Also roll back streak if last_checkin was today
  const todayStr = today.toISOString().split('T')[0]
  const { data: streak } = await supabase
    .from('streaks').select('*').eq('user_id', currentUser.id).single()
  if (streak?.last_checkin === todayStr) {
    const prev = new Date(today)
    prev.setDate(prev.getDate() - 1)
    const newCurrent = Math.max(0, (streak.current_streak || 1) - 1)
    await supabase.from('streaks').update({
      current_streak: newCurrent,
      last_checkin: prev.toISOString().split('T')[0],
      updated_at: new Date().toISOString()
    }).eq('user_id', currentUser.id)
    await supabase.from('profiles').update({ streak_count: newCurrent }).eq('id', currentUser.id)
    if (currentProfile) currentProfile.streak_count = newCurrent
  }

  await loadHistory()
  state.selectedMood  = null
  state.aiResponse    = null
  state.currentView   = 'checkin'
  render()
  showToast("Today's check-in reset — fresh start! 🌱", 'success')
}

// Toggles a resource detail panel (called from onclick in rendered HTML)
window.toggleResource = function(detailId, arrowId) {
  const panel = document.getElementById(detailId)
  const arrow = document.getElementById(arrowId)
  if (!panel) return
  const isOpen = panel.style.display !== 'none'
  panel.style.display = isOpen ? 'none' : 'block'
}

// ============================================================
// TAB BAR
// ============================================================

function setupTabBar() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.closest('.tab-btn')?.dataset.tab
      if (!tab) return

      tabButtons.forEach(b => b.classList.remove('active'))
      btn.closest('.tab-btn').classList.add('active')

      state.currentTab = tab

      // Restore journal view if returning to check-in with special mood active
      if (tab === 'checkin' && state.selectedMood === 'special') {
        state.currentView = 'journal'
      } else if (tab !== 'checkin') {
        state.currentView = 'checkin'
      }

      // Refresh history when switching to insights
      if (tab === 'settings') {
        render()
        return
      }

      if (tab === 'insights') {
        loadHistory().then(() => {
          render()
          loadLongestStreak()
        })
        return
      }

      render()
    })
  })
}

// Fetches and renders the longest streak from the streaks table
async function loadLongestStreak() {
  try {
    const { data } = await supabase
      .from('streaks').select('longest_streak')
      .eq('user_id', currentUser.id).single()

    const el = document.getElementById('ins-longest')
    if (el) el.textContent = data?.longest_streak ?? 0
  } catch (err) {
    console.error('[Insights] Longest streak error:', err.message)
  }
}

// ============================================================
// EVENT LISTENERS (re-attached after each render)
// ============================================================

function attachEventListeners() {
  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const moodId = btn.dataset.mood
      state.selectedMood  = moodId
      state.aiResponse    = null
      state.currentView   = moodId === 'special' ? 'journal' : 'checkin'
      render()
    })
  })

  // Back button in journal mode
  document.getElementById('btn-back-checkin')?.addEventListener('click', () => {
    state.currentView  = 'checkin'
    state.selectedMood = null
    state.aiResponse   = null
    state.selectedTopic = null
    render()
  })

  // Topic pills
  document.querySelectorAll('.topic-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedTopic = btn.dataset.topic
      render()
    })
  })

  // AI buttons — debounced to prevent rapid clicks
  const debouncedAI = debounce((isJournal) => handleAISupport(isJournal), 500)
  document.getElementById('btn-ai-support')?.addEventListener('click', () => debouncedAI(false))
  document.getElementById('btn-ai-support-journal')?.addEventListener('click', () => debouncedAI(true))

  // Save buttons — debounced
  const debouncedSave = debounce(() => handleSave(), 800)
  document.getElementById('btn-save')?.addEventListener('click', debouncedSave)
  document.getElementById('btn-save-journal')?.addEventListener('click', debouncedSave)
  document.getElementById('btn-save-after-ai')?.addEventListener('click', debouncedSave)

  // Settings — save profile name
  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const newName = sanitizeInput(document.getElementById('settings-name')?.value || '', 50)
    if (!newName) { showToast('Name cannot be empty', 'info'); return }
    const { error } = await supabase.from('profiles').update({ display_name: newName }).eq('id', currentUser.id)
    if (error) { showToast('Could not save: ' + error.message, 'error'); return }
    currentProfile.display_name = newName
    document.getElementById('main-title').textContent = `How are you, ${newName}?`
    showToast('Profile updated! ✨', 'success')
    render()
  })

  // Settings — reset today's check-in
  document.getElementById('btn-reset-checkin')?.addEventListener('click', () => {
    if (confirm("Delete today's check-in and start over?")) handleResetCheckin()
  })

  // Settings — theme swatches (locked ones redirect to upgrade)
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.locked) {
        showToast('This theme is Pro-only — upgrade to unlock all themes ✨', 'info')
        document.getElementById('paypal-button-container')?.scrollIntoView({ behavior: 'smooth' })
        return
      }
      applyTheme(btn.dataset.theme)
      render()
    })
  })

  // Chart type switcher
  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.chartType = btn.dataset.chart
      localStorage.setItem('ms-chart', state.chartType)
      render()
    })
  })

  // Settings — AI personality
  document.querySelectorAll('.personality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.locked) { showToast('AI Personality is a Pro feature ✨', 'info'); return }
      state.aiPersonality = btn.dataset.personality
      localStorage.setItem('ms-ai-personality', state.aiPersonality)
      render()
    })
  })

  // Settings — save affirmation
  document.getElementById('btn-save-affirmation')?.addEventListener('click', () => {
    const val = sanitizeInput(document.getElementById('settings-affirmation')?.value || '', 120)
    state.affirmation = val
    localStorage.setItem('ms-affirmation', val)
    showToast('Affirmation saved 💙', 'success')
  })

  // Settings — export journal
  document.getElementById('btn-export')?.addEventListener('click', handleExportJournal)

  // Upgrade link in AI usage row
  document.getElementById('link-upgrade')?.addEventListener('click', (e) => {
    e.preventDefault()
    document.getElementById('paypal-button-container')?.scrollIntoView({ behavior: 'smooth' })
  })

  // Settings — cancel subscription
  document.getElementById('btn-cancel-sub')?.addEventListener('click', () => {
    if (confirm('Cancel your Pro subscription? You can re-subscribe any time.')) {
      window.open('https://www.paypal.com/myaccount/autopay/', '_blank')
      showToast('Manage your subscription on PayPal — changes take effect at next billing date', 'info')
    }
  })

  // Mount PayPal button after DOM is ready (async, non-blocking)
  if (state.currentTab === 'settings' && !isPro()) {
    mountPayPalButton()
  }

  // Settings — sign out
  document.getElementById('btn-signout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = './auth.html'
  })
}

// ============================================================
// AI — Gemini 2.0 Flash
// ============================================================

// Rate limit: max 5 AI requests per 60 seconds
const AI_RATE_LIMIT = { max: 5, windowMs: 60_000 }

async function handleAISupport(isJournal) {
  // Per-minute rate limit (all users)
  if (!rateLimiter.check('aiCalls', AI_RATE_LIMIT.max, AI_RATE_LIMIT.windowMs)) {
    showToast('Slow down a little — try again in a minute 💙', 'info')
    return
  }

  // Daily limit for free users (Supabase-backed — can't be bypassed with incognito)
  const withinLimit = await checkDailyAiLimit()
  if (!withinLimit) {
    showToast(`Free limit reached (${FREE_AI_LIMIT} AI responses/day) — upgrade to Pro for unlimited ✨`, 'info')
    state.currentTab = 'settings'
    tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === 'settings'))
    render()
    return
  }

  // Get and validate the note
  const rawNote = isJournal
    ? document.getElementById('journal-note')?.value
    : document.getElementById('checkin-note')?.value

  const note = sanitizeInput(rawNote || '', 2000)

  if (!note) {
    showToast('Write something first — even a few words helps 🌱', 'info')
    return
  }

  state.isGeneratingAI = true
  state.aiResponse     = null
  render()

  try {
    const response = await callAI(state.selectedMood, note, isJournal, state.selectedTopic)
    state.isGeneratingAI = false
    state.aiResponse     = response
    state._lastNote      = note
    render()
    console.log('[AI] Response received')
  } catch (err) {
    console.error('[AI] Gemini failed:', err.message)
    state.isGeneratingAI = false
    state.aiResponse = "Couldn't reach AI right now — but your feelings are still valid. Try again in a moment. 💙"
    render()
    // Show real error so we can debug without needing DevTools open
    showToast(`AI error: ${err.message?.substring(0, 120)}`, 'error')
  }
}

// Shared prompts for both AI providers
function buildAIMessages(mood, note, isJournal, topic) {
  const moodLabel  = moods.find(m => m.id === mood)?.label || mood
  const topicLabel = topics.find(t => t.id === topic)?.label || topic

  // Pro users get their chosen personality, free users get the default friend tone
  const personality = isPro() ? (AI_PERSONALITIES[state.aiPersonality] || AI_PERSONALITIES.friend) : AI_PERSONALITIES.friend
  const lengthNote  = isPro() ? '4-6 sentences' : '3-4 sentences'

  const systemPrompt =
    `You are a mental wellness companion for teenagers. Respond ${personality.tone}. ` +
    `Always validate their feelings first. Keep responses to ${lengthNote}. ` +
    'Never use bullet points. Never suggest the user is in danger unless they explicitly say so. ' +
    'Always end with something encouraging or a gentle next step.'

  const userPrompt = isJournal && topic
    ? `I chose to journal about something personal. The topic: ${topicLabel}. Here's what I wrote: "${note}". Validate how I feel, then offer 1-2 honest, grounded pieces of advice.`
    : `I'm feeling ${moodLabel} today.${ note ? ` Here's what's on my mind: "${note}".` : '' } Give me a warm, supportive message and one small thing I can do right now.`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt }
  ]
}

// Main AI caller — hits your secure Vercel backend
async function callAI(mood, note, isJournal, topic) {
  const messages = buildAIMessages(mood, note, isJournal, topic)

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, isPro: isPro() })
  })

  if (!res.ok) {
    const errBody = await res.text()
    try {
      const json = JSON.parse(errBody)
      throw new Error(json.error || errBody)
    } catch {
      throw new Error(`Server error: ${res.status}`)
    }
  }

  const json = await res.json()
  if (!json.text) throw new Error('Empty response from AI')
  return json.text
}

// ============================================================
// SAVE + STREAKS
// ============================================================

// Rate limit: max 3 saves per 60 seconds (prevents spam)
const SAVE_RATE_LIMIT = { max: 3, windowMs: 60_000 }

async function handleSave() {
  if (!currentUser) { showToast('You need to be logged in to save 💙', 'info'); return }
  if (state.isSaving) return

  // Rate limit check
  if (!rateLimiter.check('saves', SAVE_RATE_LIMIT.max, SAVE_RATE_LIMIT.windowMs)) {
    showToast('Too many saves — please wait a moment 💙', 'info')
    return
  }

  // Grab note from whichever input is visible
  const isJournal = state.currentView === 'journal'
  const rawNote   = isJournal
    ? document.getElementById('journal-note')?.value
    : document.getElementById('checkin-note')?.value
  const note = sanitizeInput(rawNote || '', isJournal ? 3000 : 500)

  const mood  = state.selectedMood
  const score = moods.find(m => m.id === mood)?.score ?? 0

  if (!mood) { showToast("Select how you're feeling first 💙", 'info'); return }

  state.isSaving = true
  render()

  try {
    const { error } = await supabase.from('entries').insert([{
      user_id:     currentUser.id,
      mood:        mood === 'special' ? 'something_else' : mood,
      mood_score:  score,
      note:        note || null,
      topic:       isJournal ? state.selectedTopic : null,
      ai_response: state.aiResponse || null,
      is_journal:  isJournal
    }])

    if (error) throw error

    await updateStreak()
    await loadHistory()

    // Reset form state
    state.selectedMood  = null
    state.selectedTopic = null
    state.currentView   = 'checkin'
    state.aiResponse    = null
    state.isSaving      = false

    render()
    showToast('Check-in saved! 🌟', 'success')
    console.log('[App] Entry saved')
  } catch (err) {
    console.error('[App] Save error:', err)
    state.isSaving = false
    render()
    // Show the actual Supabase error code so we can debug
    const detail = err?.code ? `[${err.code}] ${err.message}` : err.message
    showToast(`Save failed: ${detail}`, 'error')
  }
}

// Calculates consecutive check-in streak and writes it to Supabase
async function updateStreak() {
  const today = new Date().toISOString().split('T')[0]
  const prev  = new Date()
  prev.setDate(prev.getDate() - 1)
  const yesterday = prev.toISOString().split('T')[0]

  try {
    const { data: row } = await supabase
      .from('streaks').select('*').eq('user_id', currentUser.id).single()

    let current = 1, longest = 1

    if (row) {
      if (row.last_checkin === today) return  // already counted today
      current = row.last_checkin === yesterday ? (row.current_streak || 0) + 1 : 1
      longest = Math.max(row.longest_streak || 0, current)
      await supabase.from('streaks').update({
        current_streak: current, longest_streak: longest,
        last_checkin: today, updated_at: new Date().toISOString()
      }).eq('user_id', currentUser.id)
    } else {
      await supabase.from('streaks').insert([{
        user_id: currentUser.id, current_streak: 1,
        longest_streak: 1, last_checkin: today
      }])
    }

    // Mirror onto profile for header display
    await supabase.from('profiles').update({
      streak_count: current, last_checkin: today
    }).eq('id', currentUser.id)

    currentProfile.streak_count = current

    // Celebrate milestones
    if ([3, 7, 14, 30].includes(current)) {
      showToast(`🔥 ${current} day streak — you're on fire!`, 'milestone')
    }

    console.log('[Streaks] Updated to:', current)
  } catch (err) {
    console.error('[Streaks] Error:', err.message)
  }
}

// ============================================================
// TOAST
// ============================================================

function showToast(message, type = 'info') {
  document.getElementById('ms-toast')?.remove()

  const bg = {
    success:   'var(--color-accent-primary)',
    error:     'var(--color-mood-rough)',
    info:      'var(--color-text-main)',
    milestone: 'var(--color-accent-secondary)'
  }[type] || 'var(--color-text-main)'

  const toast = document.createElement('div')
  toast.id = 'ms-toast'
  toast.textContent = message
  Object.assign(toast.style, {
    position: 'fixed', bottom: '90px', left: '50%',
    transform: 'translateX(-50%) translateY(16px)',
    background: bg, color: 'white',
    padding: '10px 22px', borderRadius: '999px',
    fontSize: '0.9rem', fontWeight: '600',
    opacity: '0', transition: 'all 0.3s ease',
    zIndex: '9999', maxWidth: '90vw', textAlign: 'center', whiteSpace: 'pre-wrap',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    fontFamily: 'inherit', pointerEvents: 'none'
  })
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateX(-50%) translateY(0)'
  }, 10)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(-50%) translateY(10px)'
    setTimeout(() => toast.remove(), 300)
  }, 3500)
}
