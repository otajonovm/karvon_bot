/**
 * PERFORMANCE OPTIMIZATION MIGRATION
 * 
 * Target: Reduce query times from 200-500ms to <50ms
 * 
 * Changes:
 * 1. B-Tree indexes on frequently filtered columns
 * 2. Composite index for order matching
 * 3. Cleanup function for stale data (archived orders)
 * 4. Archival strategy for expired/old orders
 */

-- ============================================================================
-- 1. ORDERS TABLE INDEXES
-- ============================================================================

-- Main status index (used in 80% of queries)
CREATE INDEX IF NOT EXISTS idx_orders_status 
ON orders(status) 
WHERE status IN ('active', 'taken', 'expired');

-- Regional filtering (matching drivers by regions)
CREATE INDEX IF NOT EXISTS idx_orders_regions 
ON orders(from_region, to_region) 
WHERE status = 'active';

-- Truck type matching
CREATE INDEX IF NOT EXISTS idx_orders_truck_type 
ON orders(truck_type) 
WHERE status = 'active';

-- Source tracking (bot vs scraper)
CREATE INDEX IF NOT EXISTS idx_orders_source 
ON orders(source) 
WHERE created_at > NOW() - INTERVAL '7 days';

-- Time-based cleanup and TTL
CREATE INDEX IF NOT EXISTS idx_orders_created_at 
ON orders(created_at DESC) 
WHERE status IN ('expired', 'taken');

-- COMPOSITE INDEX: Optimal for order matching queries
-- Solves queries like: WHERE status='active' AND from_region=X AND truck_type=Y
CREATE INDEX IF NOT EXISTS idx_orders_matching 
ON orders(status, from_region, to_region, truck_type) 
WHERE status = 'active';

-- Fast lookup by user (sender)
CREATE INDEX IF NOT EXISTS idx_orders_user_id 
ON orders(user_id) 
WHERE created_at > NOW() - INTERVAL '30 days';

-- ============================================================================
-- 2. DRIVERS TABLE INDEXES
-- ============================================================================

-- Active drivers lookup (used heavily in matching)
CREATE INDEX IF NOT EXISTS idx_drivers_status 
ON drivers(status) 
WHERE status IN ('active', 'busy');

-- Regional driver search
CREATE INDEX IF NOT EXISTS idx_drivers_location 
ON drivers(current_location) 
WHERE status = 'active';

-- Truck type filter
CREATE INDEX IF NOT EXISTS idx_drivers_truck_type 
ON drivers(truck_type) 
WHERE status = 'active';

-- COMPOSITE INDEX: Driver availability by region & truck type
CREATE INDEX IF NOT EXISTS idx_drivers_matching 
ON drivers(current_location, truck_type, status) 
WHERE status = 'active';

-- Fast user lookup
CREATE INDEX IF NOT EXISTS idx_drivers_user_id 
ON drivers(user_id);

-- ============================================================================
-- 3. PAYMENTS TABLE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_status 
ON payments(status) 
WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_payments_user_id 
ON payments(user_id) 
WHERE created_at > NOW() - INTERVAL '90 days';

CREATE INDEX IF NOT EXISTS idx_payments_created_at 
ON payments(created_at DESC) 
WHERE status = 'approved';

-- ============================================================================
-- 4. USERS TABLE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_subscription 
ON users(subscription_plan, subscription_expires_at) 
WHERE subscription_plan IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone 
ON users(phone) 
WHERE phone IS NOT NULL;

-- ============================================================================
-- 5. ARCHIVE FUNCTION & CLEANUP
-- ============================================================================

-- Create archive table for old orders (optional, but recommended)
CREATE TABLE IF NOT EXISTS orders_archive (
  LIKE orders INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create partitions for old data
CREATE TABLE IF NOT EXISTS orders_archive_q1_2026 PARTITION OF orders_archive
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS orders_archive_q2_2026 PARTITION OF orders_archive
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS orders_archive_q3_2026 PARTITION OF orders_archive
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

-- Function to cleanup stale orders
CREATE OR REPLACE FUNCTION cleanup_stale_orders()
RETURNS void AS $$
BEGIN
  -- Archive orders older than 30 days
  INSERT INTO orders_archive
  SELECT * FROM orders
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND status IN ('expired', 'taken')
  ON CONFLICT DO NOTHING;

  -- Delete archived orders from main table
  DELETE FROM orders
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND status IN ('expired', 'taken')
    AND id IN (SELECT id FROM orders_archive WHERE created_at < NOW() - INTERVAL '30 days');

  -- Delete scraper orders older than 48 hours
  DELETE FROM orders
  WHERE source = 'scraper'
    AND created_at < NOW() - INTERVAL '48 hours'
    AND status IN ('expired', 'active');

  -- Log cleanup stats
  RAISE NOTICE 'Cleanup completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Create index on archive table
CREATE INDEX IF NOT EXISTS idx_orders_archive_created_at 
ON orders_archive(created_at DESC);

-- ============================================================================
-- 6. SCHEDULE CLEANUP (PostgreSQL pg_cron)
-- ============================================================================

-- Run cleanup every 6 hours
-- Note: pg_cron must be enabled in Supabase (it usually is)
-- SELECT cron.schedule('cleanup_stale_orders', '0 */6 * * *', 'SELECT cleanup_stale_orders()');

-- If pg_cron not available, run manually from app (recommended for Supabase)
-- Execute via: supabase.rpc('cleanup_stale_orders')

-- ============================================================================
-- 7. ANALYZE & VACUUM
-- ============================================================================

-- Update statistics for query planner
ANALYZE orders;
ANALYZE drivers;
ANALYZE users;
ANALYZE payments;

-- Note: VACUUM runs automatically in PostgreSQL, but ensure autovacuum is enabled:
-- SHOW autovacuum;  -- should be 'on'

-- ============================================================================
-- 8. TABLE STATISTICS (for monitoring)
-- ============================================================================

-- View index sizes:
-- SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- View table row counts:
-- SELECT tablename, n_live_tup as rows FROM pg_stat_user_tables
-- WHERE schemaname = 'public'
-- ORDER BY n_live_tup DESC;
