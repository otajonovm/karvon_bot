-- Haydovchi guvohnomasi: ism, kuzov, reyting
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS full_name TEXT;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS body_type TEXT;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2) NOT NULL DEFAULT 5.0;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS completed_trips INTEGER NOT NULL DEFAULT 0;

UPDATE drivers
SET rating = 5.0
WHERE rating IS NULL;

UPDATE drivers
SET is_verified = true
WHERE is_verified IS DISTINCT FROM true
  AND truck_number IS NOT NULL
  AND (current_location IS NOT NULL OR from_region IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_drivers_body_type ON drivers (body_type);
CREATE INDEX IF NOT EXISTS idx_drivers_status_active ON drivers (status)
  WHERE status = 'active';
