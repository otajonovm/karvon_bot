-- Haydovchi: erkin marshrutlar + joriy joylashuv
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS preferred_routes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_location TEXT;

-- Eski from/to dan boshlang'ich massiv
UPDATE drivers
SET preferred_routes = jsonb_build_array(from_region, to_region)
WHERE (preferred_routes = '[]'::jsonb OR preferred_routes IS NULL)
  AND from_region IS NOT NULL
  AND to_region IS NOT NULL;

UPDATE drivers
SET current_location = from_region
WHERE current_location IS NULL AND from_region IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_current_location
  ON drivers (current_location);

CREATE INDEX IF NOT EXISTS idx_drivers_preferred_routes
  ON drivers USING GIN (preferred_routes);
