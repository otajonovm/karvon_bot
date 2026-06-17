-- Karvon MVP schema for Supabase (PostgreSQL)

-- Users registered via the bot
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,          -- Telegram user ID
  phone       TEXT NOT NULL,
  role        TEXT CHECK (role IN ('role_client', 'role_driver')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Driver profiles (only for users with role_driver)
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

-- Live driver geolocation per order (Phase 1)
CREATE TABLE IF NOT EXISTS order_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cargo orders (from bot wizard or scraper)
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_region       TEXT NOT NULL,
  to_region         TEXT NOT NULL,
  car_type          TEXT NOT NULL,
  cargo_details     TEXT NOT NULL,
  phone_number      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'taken')),
  taken_by          BIGINT REFERENCES users(id),
  source            TEXT NOT NULL DEFAULT 'bot' CHECK (source IN ('bot', 'scraper')),
  source_group      TEXT,
  source_message_id BIGINT,
  raw_text          TEXT,
  notification_refs JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_match ON drivers (car_type, preferred_route);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
CREATE INDEX IF NOT EXISTS idx_order_tracking_order ON order_tracking (order_id);
CREATE INDEX IF NOT EXISTS idx_order_tracking_latest ON order_tracking (order_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_route ON orders (from_region, to_region, car_type);
