-- Money is stored as integer minor units so amounts above 2^53 round-trip.

CREATE TABLE cash_ins (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN (
      'quoted',
      'settling',
      'settled',
      'sending_usdc',
      'completed',
      'failed_payment',
      'failed_stellar',
      'expired'
    )
  ),
  cop_amount INTEGER NOT NULL CHECK (cop_amount >= 0),
  cop_scale INTEGER NOT NULL,
  cop_asset TEXT NOT NULL,
  usdc_amount INTEGER NOT NULL CHECK (usdc_amount >= 0),
  usdc_scale INTEGER NOT NULL,
  usdc_asset TEXT NOT NULL,
  rate_amount INTEGER NOT NULL CHECK (rate_amount >= 0),
  rate_scale INTEGER NOT NULL,
  rate_asset TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stellar_address TEXT NOT NULL,
  memo TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_full_name TEXT NOT NULL,
  customer_document TEXT NOT NULL,
  incoming_payment_url TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  outgoing_payment_id TEXT,
  incoming_completed INTEGER NOT NULL CHECK (incoming_completed IN (0, 1)),
  stellar_tx_hash TEXT,
  stellar_envelope_xdr TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE INDEX cash_ins_status_created_at ON cash_ins (status, created_at);
CREATE INDEX cash_ins_created_at ON cash_ins (created_at);
CREATE INDEX cash_ins_customer_document_created_at ON cash_ins (customer_document, created_at);
CREATE INDEX cash_ins_expires_at ON cash_ins (expires_at);

CREATE TABLE store_grant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  nonce TEXT NOT NULL,
  continue_uri TEXT NOT NULL,
  continue_access_token TEXT NOT NULL,
  access_token TEXT,
  manage_url TEXT,
  token_expires_at TEXT,
  limit_amount INTEGER CHECK (limit_amount IS NULL OR limit_amount >= 0),
  limit_scale INTEGER,
  limit_asset TEXT,
  interval TEXT NOT NULL,
  grant_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
