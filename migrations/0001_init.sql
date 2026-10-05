-- Card Desk Drops: initial schema.
-- All timestamps are ISO-8601 UTC strings ("2026-10-05T07:30:00.000Z").
-- Money is integer minor units plus an ISO currency code.
--
-- SHARED tables describe the world (products, drops, shops, prices, sources).
-- PERSONAL tables belong to an owner and carry owner_id, ready for more than one user.

PRAGMA foreign_keys = ON;

-- =====================================================================
-- SHARED: sources and fetch state
-- =====================================================================

-- One row per fetchable unit (a source URL, or one page of a shop catalogue).
CREATE TABLE source_state (
  source_id            TEXT NOT NULL,          -- id from config/sources.yaml
  unit_key             TEXT NOT NULL,          -- URL path + page, e.g. "/products.json?page=2"
  etag                 TEXT,
  last_modified        TEXT,
  content_hash         TEXT,                   -- for sources without validators
  next_due_at          TEXT NOT NULL,
  backoff_until        TEXT,
  backoff_level        INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_attempt_at      TEXT,
  last_success_at      TEXT,
  last_failure_at      TEXT,
  last_error           TEXT,
  last_item_count      INTEGER,
  PRIMARY KEY (source_id, unit_key)
);
CREATE INDEX idx_source_state_due ON source_state (next_due_at);

-- Every run of every unit. Feeds the Source health view.
CREATE TABLE source_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL,
  unit_key     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok', 'not_modified', 'failed', 'challenge', 'robots_disallowed', 'backoff')),
  http_status  INTEGER,
  items_seen   INTEGER NOT NULL DEFAULT 0,
  items_changed INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  duration_ms  INTEGER
);
CREATE INDEX idx_source_runs_source ON source_runs (source_id, started_at DESC);

-- Mirror of config/sources.yaml retailers, synced on each dispatch, so SQL can join on it.
CREATE TABLE retailers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  country            TEXT NOT NULL,
  currency           TEXT NOT NULL,
  base_url           TEXT NOT NULL,
  ships_gi           TEXT NOT NULL CHECK (ships_gi IN ('yes', 'no', 'unknown')),
  ships_gi_verified_at TEXT,
  ships_gi_note      TEXT,
  ships_es           TEXT NOT NULL CHECK (ships_es IN ('yes', 'no', 'unknown')),
  ships_es_verified_at TEXT,
  ships_es_note      TEXT,
  -- Last /meta.json ships_to_countries seen; a change raises a "re-verify shipping" event.
  meta_ships_to      TEXT,
  meta_checked_at    TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1
);

-- =====================================================================
-- SHARED: releases, products (box SKUs) and matching
-- =====================================================================

-- A release is what calendars announce: "2026 Topps Chrome Formula 1", "Mega Evolution—Delta Reign".
CREATE TABLE releases (
  id             TEXT PRIMARY KEY,                -- ULID
  match_key      TEXT NOT NULL UNIQUE,            -- category|season|sorted subject tokens
  category       TEXT NOT NULL,
  publisher      TEXT,
  season         TEXT,
  line           TEXT,
  tier           TEXT,
  tier_points_pct INTEGER NOT NULL DEFAULT 0,
  name           TEXT NOT NULL,
  name_precedence INTEGER NOT NULL,               -- precedence of the source that named it; lower wins
  subject        TEXT NOT NULL,                   -- space-separated subject tokens
  players        TEXT,                            -- JSON array of watchlist players seen
  scarcity       TEXT,                            -- JSON array of scarcity signal ids
  origin_source  TEXT NOT NULL,                   -- source that first reported it
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_releases_category ON releases (category, season);

-- A product is a sealed box type of a release: hobby, jumbo, ETB, booster box ...
CREATE TABLE products (
  id             TEXT PRIMARY KEY,                -- ULID
  release_id     TEXT NOT NULL REFERENCES releases (id),
  configuration  TEXT NOT NULL,                   -- config id, or 'unknown'
  name           TEXT NOT NULL,
  rrp_minor      INTEGER,
  rrp_currency   TEXT,
  rrp_source     TEXT CHECK (rrp_source IN ('config', 'estimated')),
  image_key      TEXT,                            -- R2 object key
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (release_id, configuration)
);

-- Raw titles seen anywhere, mapped to a release. Deterministic first, LLM only on failure.
CREATE TABLE title_matches (
  title_hash   TEXT PRIMARY KEY,                  -- sha-256 of source id + normalised title
  raw_title    TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  category     TEXT NOT NULL,
  subject      TEXT NOT NULL,                     -- subject tokens at classification time
  season       TEXT,
  release_id   TEXT REFERENCES releases (id),     -- NULL = no release (old stock, unmatched)
  method       TEXT NOT NULL CHECK (method IN ('deterministic', 'created', 'llm', 'manual', 'unmatched')),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_title_matches_release ON title_matches (release_id);

CREATE TABLE llm_match_cache (
  title_hash  TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  response    TEXT NOT NULL,                      -- JSON
  created_at  TEXT NOT NULL
);

-- =====================================================================
-- SHARED: drops and release dates (never silently overwritten)
-- =====================================================================

CREATE TABLE drops (
  id                TEXT PRIMARY KEY,             -- ULID
  release_id        TEXT NOT NULL REFERENCES releases (id),
  kind              TEXT NOT NULL DEFAULT 'release' CHECK (kind IN ('release', 'preorder_open', 'timed_window')),
  starts_at         TEXT,                         -- NULL while TBD
  ends_at           TEXT,                         -- timed windows only
  precision         TEXT NOT NULL CHECK (precision IN ('time', 'day', 'week', 'month', 'unknown')),
  confidence        TEXT NOT NULL CHECK (confidence IN ('rumoured', 'announced', 'confirmed_date', 'confirmed_time')),
  decided_by_source TEXT,                         -- source whose observation currently wins
  status            TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'past', 'cancelled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (release_id, kind)
);
CREATE INDEX idx_drops_starts ON drops (starts_at);

-- What each source says about a drop's date, kept side by side so conflicts are visible.
CREATE TABLE drop_observations (
  drop_id      TEXT NOT NULL REFERENCES drops (id),
  source_id    TEXT NOT NULL,
  starts_at    TEXT,
  precision    TEXT NOT NULL,
  confidence   TEXT NOT NULL,
  precedence   INTEGER NOT NULL,                  -- lower wins
  region       TEXT,
  raw          TEXT,                              -- the date text exactly as published
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (drop_id, source_id)
);

-- Append-only history of the decided date.
CREATE TABLE drop_date_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id        TEXT NOT NULL REFERENCES drops (id),
  old_starts_at  TEXT,
  new_starts_at  TEXT,
  old_precision  TEXT,
  new_precision  TEXT,
  old_confidence TEXT,
  new_confidence TEXT,
  source_id      TEXT NOT NULL,
  changed_at     TEXT NOT NULL
);
CREATE INDEX idx_date_history_drop ON drop_date_history (drop_id, changed_at);

-- Shared event stream. Personal notifications are derived from it per owner.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                      -- release_discovered | date_changed | went_live | restock | source_failing | shipping_reverify ...
  drop_id     TEXT,
  release_id  TEXT,
  product_id  TEXT,
  listing_id  TEXT,
  source_id   TEXT,
  payload     TEXT,                               -- JSON
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_events_created ON events (created_at);

-- =====================================================================
-- SHARED: listings and market signals (captured from day one)
-- =====================================================================

CREATE TABLE listings (
  id             TEXT PRIMARY KEY,                -- "<retailer>:<external id>"
  retailer_id    TEXT NOT NULL REFERENCES retailers (id),
  external_id    TEXT NOT NULL,                   -- Shopify variant id, Woo product id
  product_id     TEXT REFERENCES products (id),
  url            TEXT NOT NULL,
  raw_title      TEXT NOT NULL,
  price_minor    INTEGER,
  currency       TEXT NOT NULL,
  available      INTEGER NOT NULL,
  is_preorder    INTEGER NOT NULL DEFAULT 0,
  release_text   TEXT,                            -- release date text found on the listing
  purchase_limit INTEGER,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,                   -- refreshed at most daily to save D1 writes
  last_changed_at TEXT NOT NULL,
  gone_at        TEXT,                            -- disappeared from the feed
  UNIQUE (retailer_id, external_id)
);
CREATE INDEX idx_listings_product ON listings (product_id);

-- In-stock / out-of-stock transitions (sell-out speed).
CREATE TABLE stock_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL REFERENCES listings (id),
  at          TEXT NOT NULL,
  available   INTEGER NOT NULL,
  price_minor INTEGER
);
CREATE INDEX idx_stock_events_listing ON stock_events (listing_id, at);

-- Every price change, with the RRP in force at the time (retailer price drift).
CREATE TABLE price_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   TEXT NOT NULL REFERENCES listings (id),
  at           TEXT NOT NULL,
  price_minor  INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  rrp_minor    INTEGER,
  rrp_currency TEXT,
  ratio_to_rrp REAL
);
CREATE INDEX idx_price_events_listing ON price_events (listing_id, at);

-- ECB reference rates: 1 EUR = rate units of currency.
CREATE TABLE fx_rates (
  date      TEXT NOT NULL,
  currency  TEXT NOT NULL,
  rate      REAL NOT NULL,
  PRIMARY KEY (date, currency)
);

-- =====================================================================
-- PERSONAL: everything below carries owner_id
-- =====================================================================

CREATE TABLE owners (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'Europe/Gibraltar',
  created_at  TEXT NOT NULL
);
INSERT INTO owners (id, name, created_at) VALUES ('owner_1', 'Owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE watchlist (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  target_type TEXT NOT NULL CHECK (target_type IN ('release', 'product', 'player', 'line')),
  target_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, target_type, target_id)
);

CREATE TABLE score_overrides (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  product_id  TEXT NOT NULL REFERENCES products (id),
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  note        TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, product_id)
);

CREATE TABLE pins (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  drop_id     TEXT NOT NULL REFERENCES drops (id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, drop_id)
);

-- Manual relevance tags (chase card, set, player) until checklist ingestion exists.
CREATE TABLE manual_tags (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  product_id  TEXT NOT NULL REFERENCES products (id),
  tag         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, product_id, tag)
);

-- Owner-entered RRPs. Kept personal so one user's guess never rewrites shared data.
CREATE TABLE rrp_overrides (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  product_id  TEXT NOT NULL REFERENCES products (id),
  rrp_minor   INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, product_id)
);

CREATE TABLE notification_prefs (
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  trigger     TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, trigger)
);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,                   -- ULID
  owner_id    TEXT NOT NULL REFERENCES owners (id),
  dedupe_key  TEXT NOT NULL,                      -- e.g. "t_minus_60:<drop id>:<starts_at>"
  trigger     TEXT NOT NULL,
  critical    INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT,
  event_id    INTEGER REFERENCES events (id),
  created_at  TEXT NOT NULL,
  read_at     TEXT,
  UNIQUE (owner_id, dedupe_key)
);
CREATE INDEX idx_notifications_owner ON notifications (owner_id, created_at DESC);

CREATE TABLE push_subscriptions (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES owners (id),
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  user_agent       TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead')),
  created_at       TEXT NOT NULL,
  last_sent_at     TEXT,
  last_confirmed_at TEXT,
  dead_at          TEXT,
  dead_emailed_at  TEXT
);

-- One row per attempt to deliver a notification on a channel.
CREATE TABLE notification_deliveries (
  id              TEXT PRIMARY KEY,               -- ULID; echoed back by the service worker receipt
  notification_id TEXT NOT NULL REFERENCES notifications (id),
  owner_id        TEXT NOT NULL REFERENCES owners (id),
  channel         TEXT NOT NULL CHECK (channel IN ('push', 'email')),
  subscription_id TEXT REFERENCES push_subscriptions (id),
  status          TEXT NOT NULL CHECK (status IN ('sent', 'confirmed', 'failed', 'dead_subscription')),
  http_status     INTEGER,
  error           TEXT,
  sent_at         TEXT NOT NULL,
  confirmed_at    TEXT,
  fallback_checked_at TEXT
);
CREATE INDEX idx_deliveries_pending ON notification_deliveries (status, sent_at);
