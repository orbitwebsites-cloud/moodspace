// ============================================================
// dashboard.js — School counselor dashboard logic for MoodSpace
// Shows ANONYMIZED aggregate data only — no names or personal notes
// ============================================================

// === GLOBALS ===
let currentUser = null;
let currentProfile = null;
let moodDistChart = null;
let weeklyTrendChart = null;
let topicChart = null;

// Color map for moods in charts
const MOOD_COLORS = {
  great: '#6FCF97',
  good:  '#56CCF2',
  okay:  '#F2C94C',
  low:   '#F2994A',
  rough: '#EB5757',
  something_else: '#BB6BD9'
};

// === INIT ===
// Entry point — verify counselor auth, then load all dashboard data
document.addEventListener('DOMContentLoaded', async () => {
  // Wait for Supabase client (config-loader.js → supabase.js)
  await window._supabaseReady.catch(() => {
    document.body.innerHTML =
      '<p style="padding:2rem;font-family:sans-serif;color:#B33A3A">' +
      '⚠️ Could not load app config. Check Vercel environment variables.' +
      '</p>'
  })
  await verifyCounselorAuth();
});

// === AUTH ===
// Verifies user is logged in AND has counselor role; redirects otherwise
async function verifyCounselorAuth() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    console.log('[Dashboard] No session, redirecting to auth');
    window.location.href = 'auth.html';
    return;
  }

  currentUser = session.user;

  try {
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    if (profileError) throw profileError;

    // Only counselors may access this dashboard
    if (!profile || profile.role !== 'counselor') {
      console.log('[Dashboard] Non-counselor attempted access, redirecting');
      window.location.href = 'index.html';
      return;
    }

    currentProfile = profile;
    document.getElementById('counselor-name').textContent = profile.display_name || 'Counselor';

    console.log('[Dashboard] Counselor authenticated:', profile.display_name);
    await loadAllDashboardData();
  } catch (err) {
    console.error('[Dashboard] Auth check error:', err.message);
    window.location.href = 'auth.html';
  }
}

// === DATABASE ===
// Loads all dashboard sections in sequence
async function loadAllDashboardData() {
  await Promise.all([
    loadStatsCards(),
    loadMoodDistribution(),
    loadWeeklyTrend(),
    loadTopicBreakdown(),
    checkMoodAlerts()
  ]);
}

// === DATABASE ===
// Loads the 4 stat cards at the top of the dashboard
async function loadStatsCards() {
  try {
    const school = currentProfile.school;
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString();

    // Count students at same school
    const { count: totalStudents } = await supabaseClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('school', school)
      .eq('role', 'student');

    // Check-ins today (all students, by checking entries created today)
    const { count: checkinsToday } = await supabaseClient
      .from('entries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);

    // Average mood score this week
    const { data: weekEntries } = await supabaseClient
      .from('entries')
      .select('mood_score, user_id')
      .gte('created_at', weekAgoStr);

    const avgScore = weekEntries && weekEntries.length > 0
      ? (weekEntries.reduce((s, e) => s + e.mood_score, 0) / weekEntries.length).toFixed(1)
      : '—';

    // Students who checked in this week (distinct user_ids)
    const uniqueUsers = weekEntries
      ? new Set(weekEntries.map(e => e.user_id)).size
      : 0;
    const checkinPercent = totalStudents > 0
      ? Math.round((uniqueUsers / totalStudents) * 100)
      : 0;

    // Update stat cards
    setStatCard('stat-total-students', totalStudents || 0);
    setStatCard('stat-checkins-today', checkinsToday || 0);
    setStatCard('stat-avg-mood', `${avgScore} / 5`);
    setStatCard('stat-checkin-percent', `${checkinPercent}%`);

    console.log('[Dashboard] Stats cards loaded');
  } catch (err) {
    console.error('[Dashboard] Stats card error:', err.message);
  }
}

// === UI ===
// Updates a stat card element by ID
function setStatCard(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// === DATABASE ===
// Loads mood distribution for this week and renders a doughnut chart
async function loadMoodDistribution() {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data, error } = await supabaseClient
      .from('entries')
      .select('mood')
      .gte('created_at', weekAgo.toISOString());

    if (error) throw error;

    // Count each mood
    const counts = {};
    (data || []).forEach(e => {
      counts[e.mood] = (counts[e.mood] || 0) + 1;
    });

    const moodOrder = ['great', 'good', 'okay', 'low', 'rough', 'something_else'];
    const labels = moodOrder.map(m => m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()));
    const values = moodOrder.map(m => counts[m] || 0);
    const colors = moodOrder.map(m => MOOD_COLORS[m]);

    renderDoughnutChart('mood-dist-chart', labels, values, colors);
    console.log('[Dashboard] Mood distribution loaded');
  } catch (err) {
    console.error('[Dashboard] Mood distribution error:', err.message);
  }
}

// === UI ===
// Renders a Chart.js doughnut chart
function renderDoughnutChart(canvasId, labels, data, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (moodDistChart) moodDistChart.destroy();

  moodDistChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.raw} check-ins`
          }
        }
      }
    }
  });
}

// === DATABASE ===
// Loads 4-week daily average mood scores and renders a line chart
async function loadWeeklyTrend() {
  try {
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 27);

    const { data, error } = await supabaseClient
      .from('entries')
      .select('mood_score, created_at')
      .gte('created_at', fourWeeksAgo.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by date and compute average
    const byDate = {};
    (data || []).forEach(e => {
      const date = e.created_at.split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(e.mood_score);
    });

    const labels = [];
    const averages = [];

    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      labels.push(label);

      if (byDate[dateStr] && byDate[dateStr].length > 0) {
        const avg = byDate[dateStr].reduce((s, v) => s + v, 0) / byDate[dateStr].length;
        averages.push(parseFloat(avg.toFixed(2)));
      } else {
        averages.push(null);
      }
    }

    renderLineChart('weekly-trend-chart', labels, averages);
    console.log('[Dashboard] Weekly trend loaded');
  } catch (err) {
    console.error('[Dashboard] Weekly trend error:', err.message);
  }
}

// === UI ===
// Renders a Chart.js line chart
function renderLineChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (weeklyTrendChart) weeklyTrendChart.destroy();

  weeklyTrendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Mood Score',
        data,
        borderColor: '#6C63FF',
        backgroundColor: 'rgba(108,99,255,0.1)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#6C63FF',
        fill: true,
        tension: 0.4,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          min: 0,
          max: 5,
          ticks: { stepSize: 1 },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { maxRotation: 45, maxTicksLimit: 14 },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw !== null ? `Avg: ${ctx.raw} / 5` : 'No data'
          }
        }
      }
    }
  });
}

// === DATABASE ===
// Loads topic distribution this week and renders a bar chart
async function loadTopicBreakdown() {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data, error } = await supabaseClient
      .from('entries')
      .select('topic')
      .eq('is_journal', true)
      .gte('created_at', weekAgo.toISOString())
      .not('topic', 'is', null);

    if (error) throw error;

    const topicLabels = {
      heartbreak:   '💔 Heartbreak',
      friend_drama: '👥 Friend Drama',
      family:       '🏠 Family',
      burnout:      '📚 Burnout',
      loneliness:   '😶 Loneliness',
      anger:        '😤 Anger',
      not_sure:     '🤷 Not Sure'
    };

    const counts = {};
    (data || []).forEach(e => {
      if (e.topic) counts[e.topic] = (counts[e.topic] || 0) + 1;
    });

    const labels = Object.keys(topicLabels).map(k => topicLabels[k]);
    const values = Object.keys(topicLabels).map(k => counts[k] || 0);

    renderTopicChart('topic-chart', labels, values);
    console.log('[Dashboard] Topic breakdown loaded');
  } catch (err) {
    console.error('[Dashboard] Topic breakdown error:', err.message);
  }
}

// === UI ===
// Renders the topic bar chart
function renderTopicChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (topicChart) topicChart.destroy();

  topicChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Journal entries this week',
        data,
        backgroundColor: '#6C63FF',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y: { grid: { display: false } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// === DATABASE ===
// Checks if avg mood has dropped below 2.5 for 3+ consecutive days
async function checkMoodAlerts() {
  try {
    const alertSection = document.getElementById('alert-section');
    if (!alertSection) return;

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data, error } = await supabaseClient
      .from('entries')
      .select('mood_score, created_at')
      .gte('created_at', threeDaysAgo.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by day and check consecutive low days
    const byDay = {};
    (data || []).forEach(e => {
      const day = e.created_at.split('T')[0];
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(e.mood_score);
    });

    const days = Object.keys(byDay).sort();
    let consecutiveLowDays = 0;

    days.forEach(day => {
      const scores = byDay[day];
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      if (avg < 2.5) {
        consecutiveLowDays++;
      } else {
        consecutiveLowDays = 0;
      }
    });

    if (consecutiveLowDays >= 3) {
      alertSection.classList.remove('hidden');
      console.log('[Dashboard] Mood alert triggered:', consecutiveLowDays, 'consecutive low days');
    } else {
      alertSection.classList.add('hidden');
    }
  } catch (err) {
    console.error('[Dashboard] Alert check error:', err.message);
  }
}

// === AUTH ===
// Logs the counselor out and redirects to auth page
async function logout() {
  console.log('[Dashboard] Logging out counselor');
  try {
    await supabaseClient.auth.signOut();
    window.location.href = 'auth.html';
  } catch (err) {
    console.error('[Dashboard] Logout error:', err.message);
  }
}
