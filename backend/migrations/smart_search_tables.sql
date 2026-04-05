-- ============================================================
-- RideNova Smart Search Tables Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation (required for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Search History (per-user, frequency-tracked)
CREATE TABLE IF NOT EXISTS user_searches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_name  text        NOT NULL,
  lat         float8      NOT NULL,
  lng         float8      NOT NULL,
  frequency   int         NOT NULL DEFAULT 1,
  last_used   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_searches_last_used ON user_searches(last_used DESC);

-- 2. Saved Places (Home / Work pins per user)
CREATE TABLE IF NOT EXISTS saved_places (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       text  NOT NULL,        -- "Home", "Work", custom label
  place_name  text,
  lat         float8 NOT NULL,
  lng         float8 NOT NULL,
  UNIQUE(user_id, label)             -- one Home, one Work per user
);
CREATE INDEX IF NOT EXISTS idx_saved_places_user_id ON saved_places(user_id);

-- 3. Popular Places (global, auto-incremented on each ride request)
CREATE TABLE IF NOT EXISTS popular_places (
  id           uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  place_name   text  NOT NULL UNIQUE,
  lat          float8 NOT NULL,
  lng          float8 NOT NULL,
  search_count int   NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_popular_places_count ON popular_places(search_count DESC);

-- ── Seed Popular Places (Delhi NCR) ─────────────────────────────────────────
INSERT INTO popular_places (id, place_name, lat, lng, search_count) VALUES
  (gen_random_uuid(), 'Indira Gandhi International Airport', 28.5562, 77.1000, 980),
  (gen_random_uuid(), 'New Delhi Railway Station',           28.6424, 77.2197, 870),
  (gen_random_uuid(), 'Connaught Place',                     28.6315, 77.2167, 760),
  (gen_random_uuid(), 'India Gate',                          28.6129, 77.2295, 640),
  (gen_random_uuid(), 'Cyber City, Gurugram',                28.4949, 77.0887, 520),
  (gen_random_uuid(), 'Lajpat Nagar Market',                 28.5673, 77.2434, 410),
  (gen_random_uuid(), 'Hazrat Nizamuddin Station',           28.5896, 77.2503, 390),
  (gen_random_uuid(), 'Karol Bagh',                          28.6517, 77.1907, 340)
ON CONFLICT (place_name) DO NOTHING;
