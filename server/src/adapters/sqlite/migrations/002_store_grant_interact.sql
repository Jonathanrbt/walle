-- Finish-hash inputs that are not derivable from the continuation URI.

ALTER TABLE store_grant ADD COLUMN interact_nonce TEXT NOT NULL DEFAULT '';
ALTER TABLE store_grant ADD COLUMN grant_endpoint TEXT NOT NULL DEFAULT '';
