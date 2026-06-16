-- Phase 1: universal menu + driver verification + order tracking

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS truck_type TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS passport_file_id TEXT;

UPDATE drivers
SET truck_type = car_type
WHERE truck_type IS NULL AND car_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_tracking_order ON order_tracking (order_id);
CREATE INDEX IF NOT EXISTS idx_order_tracking_latest ON order_tracking (order_id, updated_at DESC);
