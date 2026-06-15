-- Scraper metadata columns (run once in Supabase SQL Editor)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_group TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_message_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_text TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_scraper_dedup
  ON orders (source_group, source_message_id)
  WHERE source_group IS NOT NULL AND source_message_id IS NOT NULL;
