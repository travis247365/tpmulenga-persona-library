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
  dedup_key   TEXT NOT NULL,
  subject     TEXT,
  sender      TEXT,
  received_at INTEGER NOT NULL
);

-- Dedup: the same role appears in several digests over a week. The key is the
-- job id where there is one, and a hash of sender+subject+day where there is
-- not. It is NOT NULL on purpose: the previous partial index covered only rows
-- WHERE job_id IS NOT NULL, so every alert without an id - which is every
-- alert whose links we failed to decode - slipped past dedup entirely and was
-- re-counted on each re-send.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_unique
  ON alerts(account_id, dedup_key);
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

-- Self-service signup. An account is created by the app, not by hand, so the
-- system scales past one user without anyone touching the database.
--
-- There is no password: the token IS the account. It addresses the inbound
-- mail and authorises the feed read, so it is generated with the CSPRNG and
-- is long enough that guessing is not a strategy.
CREATE TABLE IF NOT EXISTS signups (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip      TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signups_ip ON signups(ip, at);
