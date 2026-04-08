// ============================================================
// auth.js — Handles all authentication logic for MoodSpace
// Covers: sign up, log in, Google OAuth, logout, password reset
// ============================================================

// === INIT ===
// Wait for Supabase client to be ready (config-loader.js → supabase.js)
// then set up the auth page and check for an existing session
document.addEventListener('DOMContentLoaded', async () => {
  await window._supabaseReady.catch(() => {
    document.body.innerHTML =
      '<p style="padding:2rem;font-family:sans-serif;color:#B33A3A">' +
      '⚠️ Could not load app config. If running locally, make sure config.js exists.' +
      '</p>'
  })
  initAuthPage();
  checkExistingSession();
});

// === AUTH STATE ===
// Checks if a user is already logged in — redirect if so
async function checkExistingSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await redirectByRole(session.user);
  }
}

// === REDIRECT BY ROLE ===
// Sends students to index.html, counselors to dashboard.html
async function redirectByRole(user) {
  try {
    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error) throw error;

    if (profile && profile.role === 'counselor') {
      window.location.href = 'dashboard.html';
    } else {
      window.location.href = 'index.html';
    }
  } catch (err) {
    console.error('[Auth] Role redirect error:', err.message);
    window.location.href = 'index.html';
  }
}

// === UI INIT ===
// Sets up tab switching and form event listeners on auth.html
function initAuthPage() {
  const loginTab = document.getElementById('login-tab');
  const signupTab = document.getElementById('signup-tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const gradeGroup = document.getElementById('grade-group');
  const roleSelect = document.getElementById('role');

  // Toggle between login and sign-up views
  if (loginTab) {
    loginTab.addEventListener('click', () => {
      loginTab.classList.add('active');
      signupTab.classList.remove('active');
      loginForm.classList.remove('hidden');
      signupForm.classList.add('hidden');
      clearMessages();
    });
  }

  if (signupTab) {
    signupTab.addEventListener('click', () => {
      signupTab.classList.add('active');
      loginTab.classList.remove('active');
      signupForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      clearMessages();
    });
  }

  // Show/hide grade dropdown based on role selection
  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      if (gradeGroup) {
        gradeGroup.style.display = roleSelect.value === 'student' ? 'block' : 'none';
      }
    });
  }

  // Wire up form submit events
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  if (signupForm) signupForm.addEventListener('submit', handleSignup);

  // Staff code toggle
  const staffToggle = document.getElementById('staff-toggle');
  const staffCodeGroup = document.getElementById('staff-code-group');
  if (staffToggle && staffCodeGroup) {
    staffToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const visible = staffCodeGroup.style.display !== 'none';
      staffCodeGroup.style.display = visible ? 'none' : 'block';
      staffToggle.textContent = visible ? '🏫 Are you school staff?' : '✕ Cancel staff sign-up';
      if (visible) {
        document.getElementById('counselor-code').value = '';
        document.getElementById('role').value = 'student';
      }
    });
  }

  // Google OAuth button
  const googleBtn = document.getElementById('google-login-btn');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleLogin);

  // Forgot password link
  const forgotLink = document.getElementById('forgot-password-link');
  if (forgotLink) forgotLink.addEventListener('click', handleForgotPassword);
}

// === SIGN UP ===
// Creates a new Supabase auth user and saves their profile to the DB
async function handleSignup(e) {
  e.preventDefault();
  clearMessages();

  const displayName = document.getElementById('display-name').value.trim();
  const email       = document.getElementById('signup-email').value.trim();
  const password    = document.getElementById('signup-password').value;
  const school      = document.getElementById('school').value.trim();
  const grade       = document.getElementById('grade')?.value || null;
  const staffCode   = document.getElementById('counselor-code')?.value.trim() || '';

  if (!displayName || !email || !password) {
    showMessage('Please fill in all required fields.', 'error');
    return;
  }

  if (password.length < 8) {
    showMessage('Password must be at least 8 characters long.', 'error');
    return;
  }
  if (!/\d/.test(password)) {
    showMessage('Password must include at least one number.', 'error');
    return;
  }

  showLoading(true, 'signup-btn');
  console.log('[Auth] Attempting sign up');

  try {
    // If a staff code was entered, verify it server-side before proceeding
    let role = 'student';
    let resolvedSchool = school; // may be overridden by the code lookup
    if (staffCode) {
      const verifyRes = await fetch('/api/verify-counselor-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: staffCode })
      });
      const result = await verifyRes.json();
      if (!result.valid) {
        showMessage('That staff code is incorrect. Please check with your school admin.', 'error');
        showLoading(false, 'signup-btn');
        return;
      }
      role = 'counselor';
      // Auto-fill the school from the code so it matches exactly in the DB
      if (result.school) resolvedSchool = result.school;
      console.log('[Auth] Valid counselor code — signing up as counselor for:', resolvedSchool);
    }

    // Create the auth user in Supabase
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, role } }
    });

    if (error) throw error;

    if (data.user) {
      await createProfile(data.user, { displayName, email, role, school: resolvedSchool, grade });
    }

    showMessage('Account created! Check your email to confirm, then log in.', 'success');
    console.log('[Auth] Sign up successful as:', role);
  } catch (err) {
    console.error('[Auth] Sign up error:', err.message);
    showMessage(err.message || 'Sign up failed. Please try again.', 'error');
  } finally {
    showLoading(false, 'signup-btn');
  }
}

// === CREATE PROFILE ===
// Inserts a new row in the profiles table with user details
async function createProfile(user, { displayName, email, role, school, grade }) {
  try {
    const { error } = await supabaseClient.from('profiles').insert([{
      id: user.id,
      email,
      display_name: displayName,
      role,
      school: school || null,
      grade: role === 'student' ? grade : null,
      streak_count: 0
    }]);

    if (error) throw error;
    console.log('[Auth] Profile created for user:', user.id);
  } catch (err) {
    console.error('[Auth] Profile creation error:', err.message);
  }
}

// === LOG IN ===
// Signs in with email and password, then redirects by role
async function handleLogin(e) {
  e.preventDefault();
  clearMessages();

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showMessage('Please enter your email and password.', 'error');
    return;
  }

  showLoading(true, 'login-btn');
  console.log('[Auth] Attempting login');

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) throw error;

    console.log('[Auth] Login successful');
    await redirectByRole(data.user);
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    showMessage('Invalid email or password. Please try again.', 'error');
  } finally {
    showLoading(false, 'login-btn');
  }
}

// === GOOGLE OAUTH ===
// Initiates Supabase Google OAuth flow (redirects to Google)
async function handleGoogleLogin() {
  console.log('[Auth] Starting Google OAuth');
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/index.html`
      }
    });
    if (error) throw error;
  } catch (err) {
    console.error('[Auth] Google OAuth error:', err.message);
    showMessage('Google sign-in failed. Please try again.', 'error');
  }
}

// === FORGOT PASSWORD ===
// Sends a password reset email via Supabase
async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();

  if (!email) {
    showMessage('Enter your email address above first, then click Forgot Password.', 'error');
    return;
  }

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth.html`
    });
    if (error) throw error;
    showMessage('Password reset email sent! Check your inbox.', 'success');
    console.log('[Auth] Password reset sent');
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    showMessage('Could not send reset email. Please try again.', 'error');
  }
}

// === LOGOUT ===
// Signs the user out and redirects to auth.html
async function logout() {
  console.log('[Auth] Logging out');
  try {
    await supabaseClient.auth.signOut();
    window.location.href = 'auth.html';
  } catch (err) {
    console.error('[Auth] Logout error:', err.message);
  }
}

// === UI HELPERS ===

// Shows a success or error message below the form
function showMessage(text, type = 'info') {
  const container = document.getElementById('auth-message');
  if (!container) return;
  container.textContent = text;
  container.className = `auth-message ${type}`;
  container.style.display = 'block';
}

// Clears any displayed message
function clearMessages() {
  const container = document.getElementById('auth-message');
  if (!container) return;
  container.textContent = '';
  container.style.display = 'none';
}

// Shows/hides a loading spinner on a button
function showLoading(isLoading, btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Please wait...' : btn.dataset.label;
}
