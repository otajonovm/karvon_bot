-- Broker P2P obuna va qo'lda chek tasdiqlash
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_orders_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_order_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS single_order_credits INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_subscription_plan_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_subscription_plan_check
      CHECK (subscription_plan IN ('free', 'pro_weekly', 'pro_monthly'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan              TEXT NOT NULL CHECK (plan IN ('pro_weekly', 'pro_monthly', 'single_order')),
  amount_uzs        BIGINT NOT NULL CHECK (amount_uzs > 0),
  receipt_photo_id  TEXT NOT NULL,
  payer_first_name  TEXT,
  payer_username    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_pending
  ON payments (status, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bot_payments_all" ON payments;
CREATE POLICY "bot_payments_all" ON payments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Bir vaqtning o'zida ikki marta publish bosilsa, free limit oshib ketmasin.
CREATE OR REPLACE FUNCTION consume_order_slot(p_user_id BIGINT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  u users%ROWTYPE;
  today DATE := CURRENT_DATE;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'user_not_found'::TEXT;
    RETURN;
  END IF;

  IF u.last_order_date IS DISTINCT FROM today THEN
    u.daily_orders_count := 0;
    UPDATE users
    SET daily_orders_count = 0, last_order_date = today, updated_at = NOW()
    WHERE id = p_user_id;
  END IF;

  IF u.subscription_plan <> 'free'
     AND u.subscription_expires_at IS NOT NULL
     AND u.subscription_expires_at > NOW() THEN
    RETURN QUERY SELECT TRUE, 'paid'::TEXT;
    RETURN;
  END IF;

  IF COALESCE(u.single_order_credits, 0) > 0 THEN
    UPDATE users
    SET single_order_credits = single_order_credits - 1, updated_at = NOW()
    WHERE id = p_user_id;
    RETURN QUERY SELECT TRUE, 'single_order'::TEXT;
    RETURN;
  END IF;

  IF COALESCE(u.daily_orders_count, 0) < 1 THEN
    UPDATE users
    SET daily_orders_count = COALESCE(daily_orders_count, 0) + 1,
        last_order_date = today,
        updated_at = NOW()
    WHERE id = p_user_id;
    RETURN QUERY SELECT TRUE, 'free'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, 'daily_limit'::TEXT;
END;
$$;

-- To'lov va foydalanuvchi krediti bir transactionda yangilanadi.
CREATE OR REPLACE FUNCTION approve_payment(p_payment_id BIGINT)
RETURNS SETOF payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p payments%ROWTYPE;
BEGIN
  SELECT * INTO p
  FROM payments
  WHERE id = p_payment_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE payments
  SET status = 'approved'
  WHERE id = p_payment_id;

  IF p.plan = 'single_order' THEN
    UPDATE users
    SET single_order_credits = COALESCE(single_order_credits, 0) + 1,
        updated_at = NOW()
    WHERE id = p.user_id;
  ELSIF p.plan = 'pro_weekly' THEN
    UPDATE users
    SET subscription_plan = p.plan,
        subscription_expires_at = NOW() + INTERVAL '7 days',
        updated_at = NOW()
    WHERE id = p.user_id;
  ELSE
    UPDATE users
    SET subscription_plan = p.plan,
        subscription_expires_at = NOW() + INTERVAL '30 days',
        updated_at = NOW()
    WHERE id = p.user_id;
  END IF;

  SELECT * INTO p FROM payments WHERE id = p_payment_id;
  RETURN NEXT p;
END;
$$;
