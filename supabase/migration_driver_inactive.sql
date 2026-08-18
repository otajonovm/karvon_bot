-- Haydovchi botni bloklaganda status=inactive
-- Supabase SQL Editor → Run

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_status_check;

ALTER TABLE drivers
  ADD CONSTRAINT drivers_status_check
  CHECK (status IN ('active', 'busy', 'inactive'));

CREATE INDEX IF NOT EXISTS idx_drivers_active_route
  ON drivers (status, from_region, to_region, truck_type)
  WHERE status = 'active';
