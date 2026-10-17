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

-- ---------------------------------------------------------------------------
-- Reply pipeline
--
-- Everything below is additive and in its OWN tables rather than new columns
-- on accounts. deploy-all.sh re-applies this whole file on every deploy, so
-- CREATE TABLE IF NOT EXISTS is idempotent while ALTER TABLE ADD COLUMN would
-- fail on the second run against a database that already has the column.
-- ---------------------------------------------------------------------------

-- Who gets a pack mailed back, and where.
--
-- Off for every account unless a row says otherwise, so a public signup never
-- causes mail to be sent to anyone. deliver_to must also be a verified
-- Email Routing destination on the Cloudflare side - the binding refuses
-- anything else - which makes "we only mail verified addresses" a platform
-- guarantee rather than a promise in code.
CREATE TABLE IF NOT EXISTS reply_settings (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  deliver_to TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 0,
  max_per_day INTEGER NOT NULL DEFAULT 6,
  updated    INTEGER NOT NULL
);

-- The derived profile the ranking reads. NOT the CV.
--
-- The app computes this in the browser from the CV and uploads it only when
-- the user presses the button. Titles, skills, seniority, years - enough to
-- rank an advert and spot a gap, and nothing that reconstructs the document.
CREATE TABLE IF NOT EXISTS profiles (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  json       TEXT    NOT NULL,
  updated    INTEGER NOT NULL
);

-- One row per role seen, as opposed to one row per email.
--
-- alerts records that a digest arrived; this records what was inside it. The
-- ranking needs titles, and a digest of fifteen roles was previously stored as
-- fifteen ids and one subject line, which is not enough to rank anything.
CREATE TABLE IF NOT EXISTS jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  dedup_key  TEXT    NOT NULL,
  title      TEXT,
  company    TEXT,
  location   TEXT,
  url        TEXT,
  source     TEXT,
  found_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_unique ON jobs(account_id, dedup_key);
CREATE INDEX IF NOT EXISTS jobs_recent ON jobs(account_id, found_at DESC);

-- An audit row per pack, written whether it succeeded or failed.
--
-- A run that sent nothing is a failed run, so the failure has to be visible
-- somewhere other than a log line that expires. status is 'sent' or 'failed';
-- detail carries the reason.
CREATE TABLE IF NOT EXISTS digests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  at         INTEGER NOT NULL,
  job_count  INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS digests_recent ON digests(account_id, at DESC);
