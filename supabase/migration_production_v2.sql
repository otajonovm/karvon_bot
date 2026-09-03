-- ═══════════════════════════════════════════════════════════════════════════
-- Karvon production v2 migration
-- SQL Editor → yangi query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. orders: 'expired' holati va expires_at ustuni
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('active', 'taken', 'expired'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Mavjud 'active' yuklar uchun default TTL: scraper=6h, bot=12h
UPDATE orders
SET expires_at =
  CASE
    WHEN source = 'scraper' THEN created_at + INTERVAL '6 hours'
    ELSE                         created_at + INTERVAL '12 hours'
  END
WHERE expires_at IS NULL;

-- 2. orders: telefon+marshrut dublikat indeksi
CREATE INDEX IF NOT EXISTS idx_orders_phone_route_dedup
  ON orders (phone_number, from_region, to_region, created_at DESC);

-- 3. drivers: muvaffaqiyatli reyslar hisoblagichi
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS completed_trips INTEGER NOT NULL DEFAULT 0;

-- 4. deal_feedback: 30 daqiqa feedback holati
CREATE TABLE IF NOT EXISTS deal_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'success', 'failed', 'timeout')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at      TIMESTAMPTZ,
  answered_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_feedback_order_driver
  ON deal_feedback (order_id, driver_id);

CREATE INDEX IF NOT EXISTS idx_deal_feedback_pending
  ON deal_feedback (status, scheduled_at)
  WHERE status = 'pending';

-- 5. completed_trips atomik oshirish uchun RPC funksiyasi
CREATE OR REPLACE FUNCTION increment_completed_trips(driver_user_id BIGINT)
RETURNS void LANGUAGE sql AS $$
  UPDATE drivers
  SET completed_trips = COALESCE(completed_trips, 0) + 1,
      updated_at = NOW()
  WHERE user_id = driver_user_id;
$$;

-- RLS
ALTER TABLE deal_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bot_deal_feedback_all" ON deal_feedback;
CREATE POLICY "bot_deal_feedback_all" ON deal_feedback
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
