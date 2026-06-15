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
  preferred_route   TEXT NOT NULL,         -- e.g. 'Toshkent-Vodiy'
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'busy')),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_route ON orders (from_region, to_region, car_type);
