-- Brokerlar (2-bosqich)
CREATE TABLE IF NOT EXISTS brokers (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS broker_phone    TEXT,
  ADD COLUMN IF NOT EXISTS broker_user_id  BIGINT REFERENCES users(id);

ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_brokers_all" ON brokers;
CREATE POLICY "bot_brokers_all" ON brokers
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);
