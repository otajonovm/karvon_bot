-- Karvon: RLS policies (run in Supabase SQL Editor after schema.sql)
-- Bot uses anon key — without these policies inserts are blocked.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_users_all" ON users;
DROP POLICY IF EXISTS "bot_drivers_all" ON drivers;
DROP POLICY IF EXISTS "bot_orders_all" ON orders;

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
