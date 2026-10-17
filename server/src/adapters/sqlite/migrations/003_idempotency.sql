-- Same Idempotency-Key plus the same request body returns the original cash-in.
-- A second insert of the same key conflicts; NULL keys stay unlimited.

ALTER TABLE cash_ins ADD COLUMN idempotency_key TEXT;
ALTER TABLE cash_ins ADD COLUMN idempotency_body TEXT;

CREATE UNIQUE INDEX cash_ins_idempotency_key ON cash_ins (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
