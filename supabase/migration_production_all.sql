-- Karvon Production: barcha migratsiyalarni bir martada ishga tushirish
-- Supabase SQL Editor → New query → Run

-- 1) Driver route + truck number
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS from_region  TEXT,
  ADD COLUMN IF NOT EXISTS to_region    TEXT,
  ADD COLUMN IF NOT EXISTS truck_number TEXT;

CREATE INDEX IF NOT EXISTS idx_drivers_route_match
  ON drivers (from_region, to_region, car_type);

-- 2) Order sender (guruh xabari egasi)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sender_username    TEXT,
  ADD COLUMN IF NOT EXISTS sender_telegram_id BIGINT;

-- 3) Brokers
CREATE TABLE IF NOT EXISTS brokers (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS broker_phone    TEXT,
  ADD COLUMN IF NOT EXISTS broker_user_id  BIGINT REFERENCES users(id);

-- 4) Driver status (agar yo'q bo'lsa)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 5) Scraper dedup index (agar yo'q bo'lsa)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_scraper_dedup
  ON orders (source_group, source_message_id)
  WHERE source_group IS NOT NULL AND source_message_id IS NOT NULL;

-- 6) RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_brokers_all" ON brokers;
DROP POLICY IF EXISTS "bot_users_all" ON users;
DROP POLICY IF EXISTS "bot_drivers_all" ON drivers;
DROP POLICY IF EXISTS "bot_orders_all" ON orders;

CREATE POLICY "bot_brokers_all" ON brokers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_users_all" ON users
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_drivers_all" ON drivers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_orders_all" ON orders
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
