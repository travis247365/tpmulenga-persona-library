-- One row per user. The token is the whole credential: it addresses the
-- inbound mail and authenticates the feed read, so it must be long and random.
CREATE TABLE IF NOT EXISTS accounts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  token    TEXT NOT NULL UNIQUE,
  label    TEXT,
  created  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  job_id      TEXT,
  subject     TEXT,
  sender      TEXT,
  received_at INTEGER NOT NULL
);

-- Dedup: the same role appears in several digests over a week. A partial index
-- keeps the uniqueness only where there is an id to be unique on, so rows
-- without one are still stored.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_unique
  ON alerts(account_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alerts_recent ON alerts(account_id, received_at DESC);

-- Mail that reached a valid address from an unrecognised sender. Kept rather
-- than dropped: a spike here is someone probing an address.
CREATE TABLE IF NOT EXISTS rejected (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  sender     TEXT,
  subject    TEXT,
  at         INTEGER NOT NULL
);
