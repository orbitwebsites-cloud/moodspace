// ============================================================
// app.js — Core logic for the MoodSpace main app (index.html)
// Handles check-ins, journal mode, AI responses, streaks, charts
// ============================================================

// === GLOBALS ===
let currentUser = null;
let currentProfile = null;
let selectedMood = null;
let selectedMoodScore = null;
let selectedTopic = null;
let isJournalMode = false;
let moodChart = null;

// Sanitizes user-supplied text before inserting into innerHTML
function sanitize(str) {
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

// Mood config: label, emoji, score used for Supabase entries
const MOODS = {
  great:          { label: 'Great',          emoji: '😄', score: 5 },
  good:           { label: 'Good',           emoji: '🙂', score: 4 },
  okay:           { label: 'Okay',           emoji: '😐', score: 3 },
  low:            { label: 'Low',            emoji: '😔', score: 2 },
  rough:          { label: 'Rough',          emoji: '😢', score: 1 },
  something_else: { label: 'Something else', emoji: '💬', score: 0 }
};

// Topic tips shown in journal mode
const TOPIC_TIPS = {
  heartbreak: {
    label: '💔 Heartbreak',
    tips: [
      'Give yourself permission to grieve — it\'s a real loss.',
      'Unfollow or mute if you need to. Protecting your peace isn\'t petty.',
      'Text a friend, not your ex. You\'ll thank yourself later.'
    ]
  },
  friend_drama: {
    label: '👥 Friend drama',
    tips: [
      'You don\'t owe anyone access to you when you\'re hurting.',
      'Try writing out what you wish you could say — you don\'t have to send it.',
      'Most fallouts look different after 48 hours. Give it time.'
    ]
  },
  family: {
    label: '🏠 Family',
    tips: [
      'Find one small space that feels like yours — even just headphones in.',
      'You can love people and still need distance from them.',
      'Talking to a school counselor isn\'t betraying your family.'
    ]
  },
  burnout: {
    label: '📚 Burnout',
    tips: [
      'Done is better than perfect right now. Finish then improve.',
      'Break it into 20-minute chunks. Your brain can do anything for 20 min.',
      'Sleep is a study strategy. A rested brain outperforms an exhausted one.'
    ]
  },
  loneliness: {
    label: '😶 Loneliness',
    tips: [
      'Loneliness lies — it tells you no one cares but that\'s not true.',
      'Try showing up somewhere consistently. Belonging takes repetition.',
      'Sometimes being around people (a cafe, library) helps without talking.'
    ]
  },
  anger: {
    label: '😤 Anger',
    tips: [
      'Anger is information. Ask: what\'s underneath it — hurt? fear? disrespect?',
      'Move your body before you respond. Walk, run, punch a pillow.',
      'You\'re allowed to feel it. You\'re not allowed to aim it at people.'
    ]
  },
  not_sure: {
    label: '🤷 Not sure',
    tips: [
      'Not knowing what you feel is still a feeling. It\'s okay to sit in it.',
      'Try finishing: "I just wish someone knew that..."',
      'Sometimes writing it out is enough. You don\'t need answers right now.'
    ]
  }
};

// === INIT ===
// Entry point — verify auth, load profile, set up UI
document.addEventListener('DOMContentLoaded', async () => {
  await verifyAuth();
  setupTabs();
  setupMoodButtons();
  setupTopicPills();
  setupAIButton();
  setupSaveButton();
});

// === AUTH ===
// Checks if user is logged in; redirects to auth.html if not
async function verifyAuth() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    console.log('[App] No session found, redirecting to auth');
    window.location.href = 'auth.html';
    return;
  }

  currentUser = session.user;
  console.log('[App] User authenticated:', currentUser.email);
  await loadProfile();
}

// === DATABASE ===
// Loads the user's profile from the profiles table
async function loadProfile() {
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    if (error) throw error;

    currentProfile = data;

    // Redirect counselors away from student app
    if (currentProfile.role === 'counselor') {
      window.location.href = 'dashboard.html';
      return;
    }

    updateGreeting();
    await loadInsightsTab();
    console.log('[App] Profile loaded for:', currentProfile.display_name);
  } catch (err) {
    console.error('[App] Profile load error:', err.message);
  }
}

// === UI ===
// Updates the greeting header with name and streak
function updateGreeting() {
  const greetingEl = document.getElementById('greeting');
  const streakEl = document.getElementById('streak-display');

  if (greetingEl && currentProfile) {
    greetingEl.textContent = `Hey ${currentProfile.display_name} 👋`;
  }

  if (streakEl) {
    const streak = currentProfile.streak_count || 0;
    streakEl.textContent = `🔥 ${streak} day streak`;
  }
}

// === UI ===
// Sets up tab navigation between Check-in, Insights, Resources
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');

      // Refresh insights chart when switching to insights tab
      if (target === 'insights') {
        loadInsightsTab();
      }
    });
  });
}

// === UI ===
// Wires up mood selection buttons (Great, Good, Okay, Low, Rough, Something else)
function setupMoodButtons() {
  const moodBtns = document.querySelectorAll('.mood-btn');

  moodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mood = btn.dataset.mood;

      moodBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      selectedMood = mood;
      selectedMoodScore = MOODS[mood]?.score ?? 0;

      console.log('[App] Mood selected:', selectedMood, 'Score:', selectedMoodScore);

      // Toggle journal mode for "Something else"
      if (mood === 'something_else') {
        enterJournalMode();
      } else {
        exitJournalMode();
      }
    });
  });
}

// === UI ===
// Switches the UI into journal mode (warm background, topic pills visible)
function enterJournalMode() {
  isJournalMode = true;
  const checkinArea = document.getElementById('checkin-area');
  const journalSection = document.getElementById('journal-section');

  checkinArea?.classList.add('journal-mode');
  journalSection?.classList.remove('hidden');

  document.getElementById('journal-heading')?.scrollIntoView({ behavior: 'smooth' });
  console.log('[App] Entered journal mode');
}

// === UI ===
// Switches the UI back to normal check-in mode
function exitJournalMode() {
  isJournalMode = false;
  selectedTopic = null;
  const checkinArea = document.getElementById('checkin-area');
  const journalSection = document.getElementById('journal-section');

  checkinArea?.classList.remove('journal-mode');
  journalSection?.classList.add('hidden');

  // Reset topic pills
  document.querySelectorAll('.topic-pill').forEach(p => p.classList.remove('selected'));
  hideTipsCard();
  console.log('[App] Exited journal mode');
}

// === UI ===
// Sets up topic pill click events in journal mode
function setupTopicPills() {
  const pills = document.querySelectorAll('.topic-pill');

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');

      selectedTopic = pill.dataset.topic;
      showTipsCard(selectedTopic);
      console.log('[App] Topic selected:', selectedTopic);
    });
  });
}

// === UI ===
// Shows the tips card for a given topic key
function showTipsCard(topicKey) {
  const tipsCard = document.getElementById('tips-card');
  const tipsTitle = document.getElementById('tips-title');
  const tipsList = document.getElementById('tips-list');

  const topicData = TOPIC_TIPS[topicKey];
  if (!topicData || !tipsCard) return;

  tipsTitle.textContent = topicData.label;
  tipsList.innerHTML = topicData.tips
    .map(tip => `<li>${tip}</li>`)
    .join('');

  tipsCard.classList.remove('hidden');
}

// === UI ===
// Hides the tips card
function hideTipsCard() {
  document.getElementById('tips-card')?.classList.add('hidden');
}

// === API ===
// Calls Gemini API with context-appropriate prompt and displays the response
async function setupAIButton() {
  const aiBtn = document.getElementById('ai-support-btn');
  if (!aiBtn) return;

  aiBtn.addEventListener('click', async () => {
    const note = document.getElementById('journal-note')?.value?.trim();

    if (!selectedMood) {
      showToast('Please select a mood first!', 'warning');
      return;
    }
    if (!note) {
      showToast('Write something first — even a few words helps.', 'warning');
      return;
    }

    const aiCard = document.getElementById('ai-response-card');
    const aiText = document.getElementById('ai-response-text');

    aiCard?.classList.remove('hidden');
    aiText.textContent = 'Thinking of something for you...';

    try {
      const response = await fetchGeminiResponse(selectedMood, note, isJournalMode, selectedTopic);
      aiText.textContent = response;
      console.log('[App] AI response received');
    } catch (err) {
      console.error('[App] AI fetch error:', err.message);
      aiText.textContent = 'You\'re not alone in this. Whatever you\'re feeling is valid — take it one breath at a time. 💙';
    }
  });
}

// === API ===
// Builds the Gemini prompt and fetches the AI response
async function fetchGeminiResponse(mood, note, isJournal, topic) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a warm, supportive teenage mental wellness companion. Give 2-3 sentence responses.' },
        { role: 'user', content: `I am feeling ${mood}. Here is my note: ${note}` }
      ],
      isPro: false
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API error ${res.status}: ${errBody}`);
  }

  const json = await res.json();
  return json.text || "You're doing great by reaching out. Keep going. 💙";
}

// === DATABASE ===
// Saves the current check-in entry to Supabase entries table
async function setupSaveButton() {
  const saveBtn = document.getElementById('save-btn');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', async () => {
    if (!selectedMood) {
      showToast('Select a mood before saving!', 'warning');
      return;
    }

    const note = document.getElementById('journal-note')?.value?.trim() || '';
    const aiText = document.getElementById('ai-response-text')?.textContent || '';
    const aiResponse = aiText === 'Thinking of something for you...' ? '' : aiText;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const { error } = await supabaseClient.from('entries').insert([{
        user_id: currentUser.id,
        mood: selectedMood,
        mood_score: selectedMoodScore,
        note: note || null,
        topic: isJournalMode ? selectedTopic : null,
        ai_response: aiResponse || null,
        is_journal: isJournalMode
      }]);

      if (error) throw error;

      console.log('[App] Entry saved successfully');
      await updateStreak();
      resetCheckinForm();
      showToast('Check-in saved! 🌟', 'success');
    } catch (err) {
      console.error('[App] Save entry error:', err.message);
      showToast('Could not save. Please try again.', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save check-in';
    }
  });
}

// === STREAKS ===
// Updates streak count based on last check-in date, shows milestone toasts
async function updateStreak() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Fetch existing streak row
    const { data: streakRow, error: fetchError } = await supabaseClient
      .from('streaks')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError; // PGRST116 = not found

    let currentStreak = 1;
    let longestStreak = 1;

    if (streakRow) {
      const lastCheckin = streakRow.last_checkin;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (lastCheckin === today) {
        // Already checked in today — don't increment
        console.log('[Streaks] Already checked in today');
        return;
      } else if (lastCheckin === yesterdayStr) {
        // Consecutive day — increment
        currentStreak = (streakRow.current_streak || 0) + 1;
      } else {
        // Missed a day — reset to 1
        currentStreak = 1;
      }

      longestStreak = Math.max(streakRow.longest_streak || 0, currentStreak);
    }

    // Upsert streak row
    const upsertData = {
      user_id: currentUser.id,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_checkin: today,
      updated_at: new Date().toISOString()
    };

    if (streakRow) {
      await supabaseClient.from('streaks').update(upsertData).eq('user_id', currentUser.id);
    } else {
      await supabaseClient.from('streaks').insert([upsertData]);
    }

    // Update profile streak_count and last_checkin
    await supabaseClient.from('profiles').update({
      streak_count: currentStreak,
      last_checkin: today
    }).eq('id', currentUser.id);

    currentProfile.streak_count = currentStreak;
    updateGreeting();

    // Celebrate milestone streaks
    const milestones = [3, 7, 14, 30];
    if (milestones.includes(currentStreak)) {
      showToast(`🔥 ${currentStreak} day streak! You're on fire!`, 'milestone');
    }

    console.log('[Streaks] Streak updated to:', currentStreak);
  } catch (err) {
    console.error('[Streaks] Streak update error:', err.message);
  }
}

// === UI ===
// Resets the check-in form back to its default state after saving
function resetCheckinForm() {
  selectedMood = null;
  selectedMoodScore = null;
  selectedTopic = null;
  isJournalMode = false;

  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.topic-pill').forEach(p => p.classList.remove('selected'));

  const noteEl = document.getElementById('journal-note');
  if (noteEl) noteEl.value = '';

  document.getElementById('ai-response-card')?.classList.add('hidden');
  document.getElementById('journal-section')?.classList.add('hidden');
  document.getElementById('checkin-area')?.classList.remove('journal-mode');
  hideTipsCard();
}

// === DATABASE ===
// Loads insights tab: 7-day chart, streak stats, recent entries
async function loadInsightsTab() {
  await loadMoodChart();
  await loadStreakStats();
  await loadRecentEntries();
}

// === DATABASE ===
// Fetches last 7 days of entries and renders a bar chart with Chart.js
async function loadMoodChart() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const fromDate = sevenDaysAgo.toISOString();

    const { data, error } = await supabaseClient
      .from('entries')
      .select('mood_score, created_at')
      .eq('user_id', currentUser.id)
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Build labels for the last 7 days
    const labels = [];
    const scores = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      labels.push(dayNames[d.getDay()]);

      // Average score for this day (could be multiple check-ins)
      const dayEntries = data.filter(e => e.created_at.startsWith(dateStr));
      if (dayEntries.length > 0) {
        const avg = dayEntries.reduce((sum, e) => sum + e.mood_score, 0) / dayEntries.length;
        scores.push(parseFloat(avg.toFixed(1)));
      } else {
        scores.push(null);
      }
    }

    renderMoodChart(labels, scores);
    console.log('[App] Mood chart loaded');
  } catch (err) {
    console.error('[App] Chart load error:', err.message);
  }
}

// === UI ===
// Renders the Chart.js bar chart on the insights tab
function renderMoodChart(labels, scores) {
  const canvas = document.getElementById('mood-chart');
  if (!canvas) return;

  if (moodChart) {
    moodChart.destroy();
  }

  moodChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Mood Score',
        data: scores,
        backgroundColor: scores.map(s => {
          if (s === null) return 'rgba(200,200,200,0.3)';
          if (s >= 4) return '#6FCF97';
          if (s >= 3) return '#56CCF2';
          if (s >= 2) return '#F2C94C';
          return '#EB5757';
        }),
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          min: 0,
          max: 5,
          ticks: {
            stepSize: 1,
            callback: val => ['–', '😢', '😔', '😐', '🙂', '😄'][val] || val
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw !== null ? `Score: ${ctx.raw} / 5` : 'No check-in'
          }
        }
      }
    }
  });
}

// === DATABASE ===
// Fetches streak data and updates the streak stats display
async function loadStreakStats() {
  try {
    const { data, error } = await supabaseClient
      .from('streaks')
      .select('current_streak, longest_streak')
      .eq('user_id', currentUser.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    const currentStreakEl = document.getElementById('current-streak-num');
    const longestStreakEl = document.getElementById('longest-streak-num');

    if (currentStreakEl) currentStreakEl.textContent = data?.current_streak || 0;
    if (longestStreakEl) longestStreakEl.textContent = data?.longest_streak || 0;

    console.log('[App] Streak stats loaded');
  } catch (err) {
    console.error('[App] Streak stats error:', err.message);
  }
}

// === DATABASE ===
// Loads and renders the 5 most recent entries in the insights tab
async function loadRecentEntries() {
  try {
    const { data, error } = await supabaseClient
      .from('entries')
      .select('mood, mood_score, note, topic, created_at, is_journal')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    const container = document.getElementById('recent-entries');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="empty-state">No check-ins yet. Start your first one above! 🌱</p>';
      return;
    }

    container.innerHTML = data.map(entry => {
      const mood = MOODS[entry.mood] || { emoji: '❓', label: 'Unknown' };
      const date = new Date(entry.created_at).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
      const notePreview = entry.note ? entry.note.substring(0, 80) + (entry.note.length > 80 ? '...' : '') : '';
      const topicLabel = entry.topic ? TOPIC_TIPS[entry.topic]?.label || entry.topic : '';

      return `
        <div class="entry-card">
          <div class="entry-header">
            <span class="entry-mood">${mood.emoji} ${mood.label}</span>
            <span class="entry-date">${date}</span>
          </div>
          ${topicLabel ? `<span class="entry-topic-tag">${sanitize(topicLabel)}</span>` : ''}
          ${notePreview ? `<p class="entry-note-preview">${sanitize(notePreview)}</p>` : ''}
        </div>
      `;
    }).join('');

    console.log('[App] Recent entries loaded:', data.length);
  } catch (err) {
    console.error('[App] Recent entries error:', err.message);
  }
}

// === UI ===
// Displays a toast notification at the bottom of the screen
function showToast(message, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('visible'), 10);

  // Auto-dismiss after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}
