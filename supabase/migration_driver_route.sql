-- Haydovchi aniq marshrut va mashina raqami
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS from_region  TEXT,
  ADD COLUMN IF NOT EXISTS to_region    TEXT,
  ADD COLUMN IF NOT EXISTS truck_number TEXT;

CREATE INDEX IF NOT EXISTS idx_drivers_route_match
  ON drivers (from_region, to_region, car_type);
