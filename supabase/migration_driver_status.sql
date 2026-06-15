-- Driver availability for push notifications
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'busy'));

CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
