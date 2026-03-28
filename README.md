# 🌈 MoodSpace

> A safe, private daily mental health check-in app built for high school students.

## 📖 Description

MoodSpace is a full-stack mental wellness web app that lets students check in with their feelings every day, journal about what's on their mind, and receive warm AI-powered support — all in a safe, private space. Students pick a mood, write a note, and optionally dive into journal mode for deeper topics like heartbreak, burnout, or family stress. Gemini AI responds like a supportive older sibling, not a clinical bot. Streaks reward consistency. A counselor dashboard gives school staff aggregate, anonymized insight into collective student wellbeing — no individual data is ever exposed. Built in 24 hours for a hackathon using pure HTML/CSS/JS, Supabase, and the Gemini API.

---

## 🎯 Problem It Solves

Teen mental health is at a crisis point. Most students have no safe, low-friction way to process their emotions daily. MoodSpace lowers the barrier to self-reflection, normalizes check-ins, and connects students to real resources — while giving counselors the aggregate signal they need to support their school proactively.

---

## 🛠 Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | HTML, CSS, JavaScript (no framework)|
| Backend    | Supabase (PostgreSQL + Auth)        |
| AI         | Google Gemini 2.0 Flash API         |
| Charts     | Chart.js (CDN)                      |
| Hosting    | Vercel                              |
| Auth       | Supabase Auth (email + Google OAuth)|

---

## 🏗 Architecture

```
Browser
  ├── auth.html      → sign up / log in (Supabase Auth)
  ├── index.html     → student app (check-in, insights, resources)
  └── dashboard.html → counselor view (aggregate charts)
        │
        ├── supabase.js  → Supabase client init
        ├── auth.js      → login / signup / OAuth / logout
        ├── app.js       → check-in, journal, AI, streaks, charts
        └── dashboard.js → counselor stats, charts, alerts
              │
              ├── Supabase DB (PostgreSQL)
              │     ├── profiles   (user info + role)
              │     ├── entries    (mood check-ins)
              │     └── streaks    (streak tracking)
              │
              └── Gemini 2.0 Flash API
                    └── generateContent endpoint
```

---

## 🗄 Supabase Setup (Step by Step)

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New project**, give it a name (e.g. `moodspace`), choose a region, set a DB password
3. Wait ~2 minutes for provisioning

### 2. Run the database SQL
Go to **SQL Editor** in your Supabase dashboard and run:

```sql
-- Users profile table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'student',
  school TEXT,
  grade TEXT,
  streak_count INT DEFAULT 0,
  last_checkin DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mood entries table
CREATE TABLE entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  mood TEXT,
  mood_score INT,
  note TEXT,
  topic TEXT,
  ai_response TEXT,
  is_journal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own entries" ON entries
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Counselors see aggregate" ON entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'counselor'
    )
  );

-- Streaks table
CREATE TABLE streaks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_checkin DATE,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Get your API keys
Go to **Project Settings → API**:
- Copy **Project URL** → this is your `SUPABASE_URL`
- Copy **anon / public** key → this is your `SUPABASE_ANON_KEY`

### 4. Enable Google OAuth (optional)
1. Go to **Authentication → Providers → Google**
2. Enable it
3. Go to [console.cloud.google.com](https://console.cloud.google.com)
4. Create a project → Enable Google+ API → Create OAuth 2.0 credentials
5. Set authorized redirect URI to: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
6. Paste Client ID and Secret back into Supabase

---

## 🔑 Get a Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key → Create API key**
4. Copy the key — it's free on the Flash tier

---

## 🔐 Environment Variables

| Variable           | Where to get it                          |
|--------------------|------------------------------------------|
| `SUPABASE_URL`     | Supabase → Project Settings → API        |
| `SUPABASE_ANON_KEY`| Supabase → Project Settings → API        |
| `GEMINI_API_KEY`   | aistudio.google.com → API keys           |

**In the code:** Open `supabase.js` and replace `YOUR_SUPABASE_URL` / `YOUR_SUPABASE_ANON_KEY`.
Open `app.js` and replace `YOUR_GEMINI_API_KEY` in the `fetchGeminiResponse` function.

---

## 💻 Run Locally

```bash
# No build step needed — just open the files!
# Option 1: VS Code Live Server extension (recommended)
# Right-click auth.html → Open with Live Server

# Option 2: Python simple server
python -m http.server 8080
# Then open http://localhost:8080/auth.html

# Option 3: npx serve
npx serve .
```

---

## 🚀 Deploy to Vercel

```bash
# 1. Push to GitHub
git init
git add .
git commit -m "Initial MoodSpace commit"
git remote add origin https://github.com/YOUR_USERNAME/moodspace.git
git push -u origin main

# 2. Deploy to Vercel
# Go to vercel.com → Import Git Repository → select your repo
# No build settings needed (static site)
# Click Deploy

# 3. Add environment variables in Vercel
# Vercel Dashboard → Your Project → Settings → Environment Variables
# Add: SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY
```

> **Note:** Since this is a pure static site, the API keys are currently in the JS files directly. For a production app, you'd want a backend proxy. For a hackathon demo this is fine.

---

## ✅ Testing Checklist

### Test Supabase Auth
- [ ] Sign up as a student → check `profiles` table in Supabase
- [ ] Sign up as a counselor → should redirect to `dashboard.html`
- [ ] Log in with wrong password → should show error
- [ ] Click "Forgot password" → check your email

### Test Database
- [ ] Save a check-in → check `entries` table in Supabase SQL editor:
  ```sql
  SELECT * FROM entries ORDER BY created_at DESC LIMIT 5;
  ```
- [ ] Check streak updates in `streaks` table:
  ```sql
  SELECT * FROM streaks;
  ```

### Test AI
- [ ] Select a mood, write a note, click "Get AI Support"
- [ ] Should show "Thinking of something for you..." then a response
- [ ] Check browser console for `[App] AI response received`

### Test Journal Mode
- [ ] Click "Something else" → journal section should appear with warm background
- [ ] Select a topic pill → tips card should appear with relevant tips
- [ ] Click "Get AI Support" → should use the journal prompt

---

## 👥 Team

- [Your Name] — Full Stack Developer
- [Teammate 2] — UI/UX Design
- [Teammate 3] — AI Integration

---

## 💡 What We Learned

- How to use Supabase Auth with Row Level Security to protect user data
- How to prompt Gemini AI for empathetic, age-appropriate responses
- How to build a multi-role app (student vs. counselor) with the same auth system
- The importance of anonymization when showing aggregate data to authority figures

---

## 🎬 Demo

[Demo video link — placeholder]

---

*Built with ❤️ at [Hackathon Name] 2025*
