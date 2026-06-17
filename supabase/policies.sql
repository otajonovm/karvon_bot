-- Karvon: RLS policies (run in Supabase SQL Editor after schema.sql)
-- Bot uses anon key — without these policies inserts are blocked.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_brokers_all" ON brokers;
DROP POLICY IF EXISTS "bot_users_all" ON users;
DROP POLICY IF EXISTS "bot_drivers_all" ON drivers;
DROP POLICY IF EXISTS "bot_orders_all" ON orders;
DROP POLICY IF EXISTS "bot_order_tracking_all" ON order_tracking;

CREATE POLICY "bot_brokers_all" ON brokers
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "bot_users_all" ON users
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "bot_drivers_all" ON drivers
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "bot_orders_all" ON orders
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "bot_order_tracking_all" ON order_tracking
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);
