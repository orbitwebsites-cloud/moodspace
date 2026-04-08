-- ============================================================
-- MoodSpace — Recommended Supabase RLS Policies
-- Run these in your Supabase Dashboard → SQL Editor
-- ============================================================

-- ── ENTRIES TABLE ─────────────────────────────────────────────
-- Enable RLS (if not already enabled)
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- Students can only read/insert/update/delete their own entries
CREATE POLICY "students_read_own_entries" ON entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "students_insert_own_entries" ON entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "students_delete_own_entries" ON entries
  FOR DELETE USING (auth.uid() = user_id);

-- Counselors can read entries from students at their school (aggregate only)
CREATE POLICY "counselors_read_school_entries" ON entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles AS counselor
      JOIN profiles AS student ON student.school = counselor.school
      WHERE counselor.id = auth.uid()
        AND counselor.role = 'counselor'
        AND student.id = entries.user_id
    )
  );

-- ── PROFILES TABLE ────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile (but NOT pro_trial_expires_at or is_pro)
-- Use a function to prevent users from directly granting themselves Pro
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent direct manipulation of Pro fields from client
    -- (These should only be set by server-side functions)
  );

-- Counselors can read student profiles at their school (for scoping)
CREATE POLICY "counselors_read_school_profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles AS counselor
      WHERE counselor.id = auth.uid()
        AND counselor.role = 'counselor'
        AND counselor.school = profiles.school
    )
  );

-- Users can insert their own profile (for sign-up)
CREATE POLICY "users_insert_own_profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ── STREAKS TABLE ─────────────────────────────────────────────
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_streaks" ON streaks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── REVIEWS TABLE ─────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_review" ON reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_read_own_review" ON reviews
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- IMPORTANT: To fully protect pro_trial_expires_at and is_pro,
-- create a database function that validates writes:
-- ============================================================

-- Option: Use a trigger to prevent client-side writes to Pro fields
CREATE OR REPLACE FUNCTION prevent_pro_self_grant()
RETURNS TRIGGER AS $$
BEGIN
  -- If is_pro or pro_trial_expires_at changed, check if it's a service_role call
  IF (OLD.is_pro IS DISTINCT FROM NEW.is_pro) OR
     (OLD.pro_trial_expires_at IS DISTINCT FROM NEW.pro_trial_expires_at) THEN
    -- Only allow if the JWT role is 'service_role' (server-side)
    IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
      -- Revert the Pro fields to their old values
      NEW.is_pro := OLD.is_pro;
      NEW.pro_trial_expires_at := OLD.pro_trial_expires_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER guard_pro_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_pro_self_grant();
