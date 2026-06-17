-- Guruh xabar egasi (DM tugmasi uchun)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sender_username    TEXT,
  ADD COLUMN IF NOT EXISTS sender_telegram_id BIGINT;
