-- ═══════════════════════════════════════════════════════════════════════════
-- KARVON — Yangi Supabase loyiha (bo'sh database)
-- 1) supabase.com → New Project
-- 2) SQL Editor → New query → bu faylni Run
-- ═══════════════════════════════════════════════════════════════════════════

-- Foydalanuvchilar (Telegram)
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,
  phone       TEXT NOT NULL,
  role        TEXT CHECK (role IN ('role_client', 'role_driver')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Brokerlar
CREATE TABLE IF NOT EXISTS brokers (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Yuklar (bot + scraper)
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_region         TEXT NOT NULL,
  to_region           TEXT NOT NULL,
  car_type            TEXT NOT NULL,
  cargo_details       TEXT NOT NULL,
  phone_number        TEXT NOT NULL,
  broker_phone        TEXT,
  broker_user_id      BIGINT REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'taken')),
  taken_by            BIGINT REFERENCES users(id),
  source              TEXT NOT NULL DEFAULT 'bot' CHECK (source IN ('bot', 'scraper')),
  source_group        TEXT,
  source_message_id   BIGINT,
  raw_text            TEXT,
  sender_username     TEXT,
  sender_telegram_id  BIGINT,
  notification_refs   JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Haydovchilar
CREATE TABLE IF NOT EXISTS drivers (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  car_type          TEXT NOT NULL,
  truck_type        TEXT,
  preferred_route   TEXT NOT NULL,
  from_region       TEXT,
  to_region         TEXT,
  truck_number      TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'busy')),
  is_verified       BOOLEAN NOT NULL DEFAULT false,
  passport_file_id  TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Haydovchi geolokatsiya (keyingi bosqich)
CREATE TABLE IF NOT EXISTS order_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indekslar
CREATE INDEX IF NOT EXISTS idx_drivers_match ON drivers (car_type, preferred_route);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
CREATE INDEX IF NOT EXISTS idx_drivers_route_match ON drivers (from_region, to_region, car_type);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_route ON orders (from_region, to_region, car_type);
CREATE INDEX IF NOT EXISTS idx_order_tracking_order ON order_tracking (order_id);
CREATE INDEX IF NOT EXISTS idx_order_tracking_latest ON order_tracking (order_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_scraper_dedup
  ON orders (source_group, source_message_id)
  WHERE source_group IS NOT NULL AND source_message_id IS NOT NULL;

-- RLS (bot anon key bilan ishlashi uchun)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_users_all" ON users;
DROP POLICY IF EXISTS "bot_drivers_all" ON drivers;
DROP POLICY IF EXISTS "bot_orders_all" ON orders;
DROP POLICY IF EXISTS "bot_brokers_all" ON brokers;
DROP POLICY IF EXISTS "bot_order_tracking_all" ON order_tracking;

CREATE POLICY "bot_users_all" ON users
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_drivers_all" ON drivers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_orders_all" ON orders
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_brokers_all" ON brokers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bot_order_tracking_all" ON order_tracking
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
