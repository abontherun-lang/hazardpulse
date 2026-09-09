-- HazardPulse — PostGIS Schema
-- Idempotent: safe to run on every startup.

-- ===================== EXTENSIONS =====================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ===================== CORE TABLES =====================

CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    event       TEXT NOT NULL,
    category    TEXT NOT NULL,
    severity    TEXT NOT NULL,
    headline    TEXT NOT NULL,
    description TEXT DEFAULT '',
    area_desc   TEXT DEFAULT '',
    color       TEXT NOT NULL,
    source_url  TEXT DEFAULT '',
    event_time  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ,
    geom        GEOMETRY(Geometry, 4326) NOT NULL,
    props       JSONB DEFAULT '{}',
    state_abbr  TEXT,
    state_name  TEXT,
    county      TEXT,
    city        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_geom ON events USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_events_source_expires ON events (source, expires_at);
CREATE INDEX IF NOT EXISTS idx_events_time ON events (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_category ON events (category);

-- Clean Census place names: "indianapolis city (balance)" → "indianapolis"
-- Stored as a SQL function to avoid regex/parameter conflicts in INSERT queries.
CREATE OR REPLACE FUNCTION clean_place_name(name TEXT) RETURNS TEXT AS $$
BEGIN
  IF name IS NULL THEN RETURN NULL; END IF;
  -- Strip consolidated/unified/metropolitan government patterns
  name := REGEXP_REPLACE(name, '(-[a-z ]+)? (city |county )?(unified |consolidated |metropolitan )?government ?\(balance\)', '');
  -- Strip "city/town/village/cdp/borough (balance)" suffixes
  name := REGEXP_REPLACE(name, ' (city|town|village|cdp|borough) \(balance\)', '');
  RETURN TRIM(name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Partial index on expires_at for the hot query filter (WHERE expires_at > NOW())
CREATE INDEX IF NOT EXISTS idx_events_active ON events (expires_at)
  WHERE expires_at IS NOT NULL;

-- Aggressive autovacuum for high-churn table
ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.05);

-- One-shot migrations that have run (see migrations.js)
CREATE TABLE IF NOT EXISTS app_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    applied_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_meta (
    source      TEXT PRIMARY KEY,
    last_update TIMESTAMPTZ,
    last_count  INTEGER DEFAULT 0
);

-- Scanner/radio lookup — Broadcastify channel IDs by place name + state
-- Loaded from data/scanner_lookup.json (27,302 entries) on first start
-- Joined server-side via county/state from TIGER reverse geocoding
CREATE TABLE IF NOT EXISTS scanners (
    name        TEXT NOT NULL,       -- lowercase place/county name
    state_abbr  TEXT NOT NULL,       -- 2-letter state abbreviation
    channel_id  INTEGER NOT NULL,    -- Broadcastify channel ID
    PRIMARY KEY (name, state_abbr)
);

-- State FIPS codes for Broadcastify state-level fallback links
CREATE TABLE IF NOT EXISTS state_fips (
    state_abbr  TEXT PRIMARY KEY,
    fips        TEXT NOT NULL
);
