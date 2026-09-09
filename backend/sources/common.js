/**
 * Shared utilities for all data source fetchers.
 *
 * To add a new data source:
 * 1. Create a new file in sources/ (copy an existing one as template)
 * 2. Export { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX }
 * 3. Register it in server.js
 *
 * Each source normalizes data and calls storeEvent() / storeEvents(),
 * which writes to PostGIS with automatic reverse geocoding via TIGER/Line.
 */

const { pool } = require('../db');

// ===================== TEXT =====================

/**
 * Normalize a value from an upstream feed to plain text: string, control
 * characters stripped, trimmed. Nothing is HTML-escaped here — the API
 * serves JSON and the frontend escapes once, at render (esc() in app.js).
 * Escaping at store time as well double-encodes: "Fisher's" became
 * "Fisher&#x27;s" on the map before 2026-09-08.
 */
function text(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function sanitizeUrl(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return '';
}

// ===================== US BOUNDING BOX =====================

function isInUS(lat, lon) {
  if (lat >= 24.5 && lat <= 49.5 && lon >= -125 && lon <= -66.5) return true;   // Continental
  if (lat >= 51 && lat <= 72 && lon >= -180 && lon <= -129) return true;         // Alaska
  if (lat >= 18.5 && lat <= 22.5 && lon >= -161 && lon <= -154) return true;     // Hawaii
  if (lat >= 17.5 && lat <= 18.6 && lon >= -67.5 && lon <= -64.5) return true;   // Puerto Rico/USVI
  if (lat >= 13.2 && lat <= 13.7 && lon >= 144.6 && lon <= 145.0) return true;   // Guam
  return false;
}

// ===================== TTL CONSTANTS =====================

const TTL = {
  WEATHER: 3600,      // 1 hour (or alert expiry)
  GDELT: 259200,      // 72 hours
  WILDFIRE: 86400,    // 24 hours
  EARTHQUAKE: 86400,  // 24 hours
  FEMA: 21600,        // 6 hours
  DISPATCH: 14400,    // 4 hours
  TORNADO: 604800,    // 7 days (matches SPC weekly feed)
  SURVEY: 604800,     // 7 days (DAT surveys; the display window trims to recent edits)
  NIFC: 21600,        // 6 hours (incidents poll hourly; tolerate fetch gaps)
  VOLCANO: 7200       // 2 hours (alert levels change slowly)
};

// Rolling display window: the API only serves events whose event_time falls
// within the last N hours, regardless of TTL. Keeps the map (and time slider)
// focused on recent activity instead of every still-unexpired record. Ongoing
// incidents (NIFC fires, volcanoes) stamp their event_time at ingestion so they
// stay inside the window while they remain active. Env-overridable.
const DISPLAY_WINDOW_HOURS = parseInt(process.env.DISPLAY_WINDOW_HOURS) || 72;

// ===================== CRON =====================

/**
 * Minutes between runs for the cron shapes this app uses:
 *   "*\/N * * * *" → N,  "M * * * *" → 60,  "0 *\/H * * *" → 60*H.
 * Used for the source-freshness display; unknown shapes return null.
 */
function cronIntervalMinutes(expr) {
  const [min, hour] = String(expr || '').trim().split(/\s+/);
  if (!min) return null;
  let m = min.match(/^\*\/(\d+)$/);
  if (m) return parseInt(m[1]);
  if (/^\d+$/.test(min)) {
    if (hour === '*') return 60;
    m = (hour || '').match(/^\*\/(\d+)$/);
    if (m) return 60 * parseInt(m[1]);
  }
  return null;
}

// ===================== GEO HELPERS =====================

/** Great-circle distance between two lat/lon points, in kilometers. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p, dLon = (lon2 - lon1) * p;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===================== KNOWN COLUMNS =====================
// Fields that map directly to events table columns.
// Anything else in the data object goes into props JSONB.

const KNOWN_FIELDS = new Set([
  'event', 'category', 'severity', 'headline', 'description',
  'areaDesc', 'color', 'sourceUrl', 'timestamp',
  'lat', 'lon', 'geometry'
]);

// ===================== GEOMETRY HELPERS =====================

/**
 * Build a GeoJSON string from data. Accepts either:
 *   { geometry: { type: 'Polygon', coordinates: [...] } }
 *   { lat: 39.768, lon: -86.158 }
 */
function buildGeoJSON(data) {
  if (data.geometry) {
    return JSON.stringify(data.geometry);
  }
  const lat = parseFloat(data.lat);
  const lon = parseFloat(data.lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
}

/**
 * Get centroid point GeoJSON for reverse geocoding.
 * For point geometry, use as-is. For polygons, compute centroid in SQL.
 */
function isPointGeometry(data) {
  if (data.geometry && data.geometry.type && data.geometry.type !== 'Point') return false;
  return true;
}

// ===================== STORAGE =====================

/**
 * Store a single event in PostGIS with automatic reverse geocoding.
 *
 * @param {string} source - Source name (e.g. 'NOAA', 'USGS')
 * @param {string} id - Unique event ID
 * @param {object} data - Event data with known fields + extras for props JSONB
 * @param {number} ttl - TTL in seconds
 */
async function storeEvent(source, id, data, ttl) {
  const geojson = buildGeoJSON(data);
  if (!geojson) {
    console.warn(`   [${source}] Skipped ${id}: bad or missing geometry`);
    return;
  }

  // Separate known columns from extras (extras → props JSONB)
  const props = {};
  for (const [key, val] of Object.entries(data)) {
    if (!KNOWN_FIELDS.has(key) && val !== undefined && val !== null && val !== '') {
      props[key] = val;
    }
  }

  let eventTime = data.timestamp
    ? new Date(typeof data.timestamp === 'string' ? parseInt(data.timestamp) : data.timestamp)
    : new Date();
  if (isNaN(eventTime.getTime())) eventTime = new Date();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // $15 = true for point geometry, false for polygon (use centroid for geocoding)
  const isPoint = isPointGeometry(data);

  await pool.query(`
    INSERT INTO events (
      id, source, event, category, severity, headline, description,
      area_desc, color, source_url, event_time, expires_at,
      geom, props, state_abbr, state_name, county, city
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      ST_GeomFromGeoJSON($13), $14,
      (SELECT stusps FROM tiger_states WHERE ST_Intersects(geom,
        CASE WHEN $15 THEN ST_GeomFromGeoJSON($13) ELSE ST_Centroid(ST_GeomFromGeoJSON($13)) END) LIMIT 1),
      (SELECT LOWER(name) FROM tiger_states WHERE ST_Intersects(geom,
        CASE WHEN $15 THEN ST_GeomFromGeoJSON($13) ELSE ST_Centroid(ST_GeomFromGeoJSON($13)) END) LIMIT 1),
      (SELECT LOWER(name) FROM tiger_counties WHERE ST_Intersects(geom,
        CASE WHEN $15 THEN ST_GeomFromGeoJSON($13) ELSE ST_Centroid(ST_GeomFromGeoJSON($13)) END) LIMIT 1),
      (SELECT clean_place_name(LOWER(name)) FROM tiger_places WHERE ST_Intersects(geom,
        CASE WHEN $15 THEN ST_GeomFromGeoJSON($13) ELSE ST_Centroid(ST_GeomFromGeoJSON($13)) END) LIMIT 1)
    )
    ON CONFLICT (id) DO UPDATE SET
      event = EXCLUDED.event, category = EXCLUDED.category,
      severity = EXCLUDED.severity, headline = EXCLUDED.headline,
      description = EXCLUDED.description, area_desc = EXCLUDED.area_desc,
      color = EXCLUDED.color, source_url = EXCLUDED.source_url,
      event_time = EXCLUDED.event_time, expires_at = EXCLUDED.expires_at,
      geom = CASE WHEN ST_GeometryType(events.geom) != 'ST_Point' AND ST_GeometryType(EXCLUDED.geom) = 'ST_Point'
                  THEN events.geom ELSE EXCLUDED.geom END,
      props = EXCLUDED.props,
      state_abbr = EXCLUDED.state_abbr, state_name = EXCLUDED.state_name,
      county = EXCLUDED.county, city = EXCLUDED.city
  `, [
    id, source,
    data.event || '', data.category || '', data.severity || 'Unknown',
    data.headline || '', data.description || '', data.areaDesc || '',
    data.color || '#808080', data.sourceUrl || '',
    eventTime, expiresAt,
    geojson, JSON.stringify(props), isPoint
  ]);
}

/**
 * Batch store events in a single transaction.
 * Much faster than individual storeEvent calls for high-volume sources.
 *
 * @param {string} source - Source name
 * @param {Array<{id, ...data}>} events - Array of event data objects (must include 'id')
 * @param {number} ttl - TTL in seconds
 */
async function storeEvents(source, events, ttl) {
  if (events.length === 0) return;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Phase 1: Insert/update rows WITHOUT geocoding (fast, no spatial queries per row)
    let skipped = 0;
    for (const evt of events) {
      const geojson = buildGeoJSON(evt);
      if (!geojson) { skipped++; continue; }

      const props = {};
      for (const [key, val] of Object.entries(evt)) {
        if (key === 'id') continue;
        if (!KNOWN_FIELDS.has(key) && val !== undefined && val !== null && val !== '') {
          props[key] = val;
        }
      }

      let eventTime = evt.timestamp
        ? new Date(typeof evt.timestamp === 'string' ? parseInt(evt.timestamp) : evt.timestamp)
        : new Date();
      if (isNaN(eventTime.getTime())) eventTime = new Date();
      const expiresAt = new Date(Date.now() + ttl * 1000);

      await dbClient.query(`
        INSERT INTO events (
          id, source, event, category, severity, headline, description,
          area_desc, color, source_url, event_time, expires_at, geom, props
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          ST_GeomFromGeoJSON($13), $14
        )
        ON CONFLICT (id) DO UPDATE SET
          event = EXCLUDED.event, category = EXCLUDED.category,
          severity = EXCLUDED.severity, headline = EXCLUDED.headline,
          description = EXCLUDED.description, area_desc = EXCLUDED.area_desc,
          color = EXCLUDED.color, source_url = EXCLUDED.source_url,
          event_time = EXCLUDED.event_time, expires_at = EXCLUDED.expires_at,
          geom = CASE WHEN ST_GeometryType(events.geom) != 'ST_Point' AND ST_GeometryType(EXCLUDED.geom) = 'ST_Point'
                      THEN events.geom ELSE EXCLUDED.geom END,
          props = EXCLUDED.props
      `, [
        evt.id, source,
        evt.event || '', evt.category || '', evt.severity || 'Unknown',
        evt.headline || '', evt.description || '', evt.areaDesc || '',
        evt.color || '#808080', evt.sourceUrl || '',
        eventTime, expiresAt,
        geojson, JSON.stringify(props)
      ]);
    }

    // Phase 2: Batch geocode all rows from this source that lack geo fields.
    // One query resolves state/county/city for all rows at once via TIGER spatial joins.
    await dbClient.query(`
      UPDATE events e SET
        state_abbr = geo.state_abbr,
        state_name = geo.state_name,
        county     = geo.county,
        city       = geo.city
      FROM (
        SELECT e2.id,
          (SELECT stusps FROM tiger_states WHERE ST_Intersects(geom, pt) LIMIT 1) AS state_abbr,
          (SELECT LOWER(name) FROM tiger_states WHERE ST_Intersects(geom, pt) LIMIT 1) AS state_name,
          (SELECT LOWER(name) FROM tiger_counties WHERE ST_Intersects(geom, pt) LIMIT 1) AS county,
          (SELECT clean_place_name(LOWER(name)) FROM tiger_places WHERE ST_Intersects(geom, pt) LIMIT 1) AS city
        FROM events e2,
        LATERAL (SELECT CASE
          WHEN ST_GeometryType(e2.geom) = 'ST_Point' THEN e2.geom
          ELSE ST_Centroid(e2.geom)
        END AS pt) centroid
        WHERE e2.source = $1 AND e2.state_abbr IS NULL
      ) geo
      WHERE e.id = geo.id
    `, [source]);

    await dbClient.query('COMMIT');
    if (skipped > 0) console.warn(`   [${source}] Skipped ${skipped}/${events.length} events: bad geometry`);
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }
}

// ===================== QUERIES =====================

/** Title-case a lowercase string (e.g. "marion" → "Marion") */
function titleCase(s) {
  if (!s) return s;
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Convert a database row to a GeoJSON Feature.
 */
function rowToFeature(row) {
  // Build scanner URL from joined data (city/county match, then state fallback)
  let scannerUrl = null;
  if (row.scanner_ctid) {
    scannerUrl = `https://www.broadcastify.com/listen/ctid/${row.scanner_ctid}`;
  } else if (row.state_fips) {
    scannerUrl = `https://www.broadcastify.com/listen/stid/${row.state_fips}`;
  }

  return {
    type: 'Feature',
    id: row.id,
    properties: {
      event: row.event,
      category: row.category,
      severity: row.severity,
      headline: row.headline,
      description: row.description,
      areaDesc: row.area_desc,
      color: row.color,
      sourceUrl: row.source_url,
      timestamp: parseInt(row.timestamp),
      source: row.source,
      // Reverse geocoded location
      ...(row.state_abbr && { state: row.state_abbr }),
      ...(row.state_name && { stateName: titleCase(row.state_name) }),
      ...(row.county && { county: titleCase(row.county) }),
      ...(row.city && { cityName: titleCase(row.city) }),
      // Scanner link (resolved server-side via JOIN)
      ...(scannerUrl && { scannerUrl }),
      // Source-specific extras from JSONB
      ...(row.props || {})
    },
    geometry: row.geometry
  };
}

/**
 * Get all active events for a single source as a GeoJSON FeatureCollection.
 *
 * @param {string} source - Source name (e.g. 'NOAA')
 * @returns {object} GeoJSON FeatureCollection with meta
 */
async function getActiveEvents(source) {
  const result = await pool.query(`
    SELECT id, source, event, category, severity, headline, description,
           area_desc, color, source_url,
           EXTRACT(EPOCH FROM event_time) * 1000 AS timestamp,
           ST_AsGeoJSON(geom)::json AS geometry,
           props, state_abbr, state_name, county, city
    FROM events
    WHERE source = $1 AND (expires_at IS NULL OR expires_at > NOW())
      AND event_time > NOW() - (INTERVAL '1 hour' * $2)
    ORDER BY event_time DESC
  `, [source, DISPLAY_WINDOW_HOURS]);

  const metaResult = await pool.query(
    'SELECT last_update, last_count FROM source_meta WHERE source = $1',
    [source]
  );
  const meta = metaResult.rows[0] || {};

  return {
    type: 'FeatureCollection',
    features: result.rows.map(rowToFeature),
    meta: {
      count: result.rows.length,
      source,
      lastUpdate: meta.last_update || null
    }
  };
}

/**
 * Get ALL active events across all sources. Single query, one DB round-trip.
 * Returns features + per-source meta + time bounds for the UI slider.
 *
 * @param {Array<{SOURCE_NAME, PREFIX}>} sources - Source definitions
 * @returns {{ features: Array, meta: object }}
 */
async function getAllActiveEvents(sources) {
  const [featResult, statsResult, metaResult] = await Promise.all([
    // All active features with scanner links resolved via JOIN
    pool.query(`
      SELECT e.id, e.source, e.event, e.category, e.severity, e.headline,
             e.description, e.area_desc, e.color, e.source_url,
             EXTRACT(EPOCH FROM e.event_time) * 1000 AS timestamp,
             ST_AsGeoJSON(e.geom)::json AS geometry,
             e.props, e.state_abbr, e.state_name, e.county, e.city,
             COALESCE(sp.channel_id, sc.channel_id) AS scanner_ctid,
             sf.fips AS state_fips
      FROM events e
      LEFT JOIN scanners sc ON sc.name = e.county AND sc.state_abbr = e.state_abbr
      LEFT JOIN scanners sp ON sp.name = e.city AND sp.state_abbr = e.state_abbr
      LEFT JOIN state_fips sf ON sf.state_abbr = e.state_abbr
      WHERE (e.expires_at IS NULL OR e.expires_at > NOW())
        AND e.event_time > NOW() - (INTERVAL '1 hour' * $1)
      ORDER BY e.event_time DESC
    `, [DISPLAY_WINDOW_HOURS]),
    // Per-source counts + time bounds
    pool.query(`
      SELECT
        source,
        COUNT(*) AS count,
        MIN(EXTRACT(EPOCH FROM event_time) * 1000) AS time_min,
        MAX(EXTRACT(EPOCH FROM event_time) * 1000) AS time_max
      FROM events
      WHERE (expires_at IS NULL OR expires_at > NOW())
        AND event_time > NOW() - (INTERVAL '1 hour' * $1)
      GROUP BY source
    `, [DISPLAY_WINDOW_HOURS]),
    // Source metadata (last update times)
    pool.query('SELECT source, last_update, last_count FROM source_meta')
  ]);

  const features = featResult.rows.map(rowToFeature);

  // Build per-source meta keyed by PREFIX (for frontend compatibility)
  const sourceCounts = {};
  let globalMin = Infinity, globalMax = -Infinity;
  for (const row of statsResult.rows) {
    sourceCounts[row.source] = parseInt(row.count);
    if (row.time_min < globalMin) globalMin = parseFloat(row.time_min);
    if (row.time_max > globalMax) globalMax = parseFloat(row.time_max);
  }

  const metaBySource = {};
  for (const row of metaResult.rows) {
    metaBySource[row.source] = row;
  }

  const meta = {};
  for (const src of sources) {
    const m = metaBySource[src.SOURCE_NAME] || {};
    meta[src.PREFIX] = {
      count: sourceCounts[src.SOURCE_NAME] || 0,
      source: src.SOURCE_NAME,
      lastUpdate: m.last_update || null,
      refreshMinutes: cronIntervalMinutes(src.CRON_SCHEDULE)
    };
  }
  meta.timeBounds = {
    min: globalMin === Infinity ? 0 : globalMin,
    max: globalMax === -Infinity ? 0 : globalMax
  };

  return { features, meta };
}

/**
 * Update the last_update timestamp and count for a source.
 */
async function setLastUpdate(source, count = 0) {
  await pool.query(`
    INSERT INTO source_meta (source, last_update, last_count)
    VALUES ($1, NOW(), $2)
    ON CONFLICT (source) DO UPDATE SET last_update = NOW(), last_count = $2
  `, [source, count]);
}

/**
 * Precise US filter backstop. Removes point events for `source` that did not
 * reverse-geocode to any US state (state_abbr IS NULL) — i.e. points the coarse
 * isInUS() bounding box let through but that actually fall in Canada/Mexico.
 * Run AFTER storeEvents(), which populates state_abbr via the TIGER spatial join.
 * Returns the number of rows pruned.
 */
async function deleteWhereNoUSState(source) {
  const res = await pool.query(
    'DELETE FROM events WHERE source = $1 AND state_abbr IS NULL',
    [source]
  );
  return res.rowCount || 0;
}

/** Count currently-active (unexpired) events for a source. */
async function countActiveEvents(source) {
  const res = await pool.query(
    'SELECT COUNT(*)::int AS n FROM events WHERE source = $1 AND (expires_at IS NULL OR expires_at > NOW())',
    [source]
  );
  return res.rows[0].n;
}

module.exports = {
  text, sanitizeUrl, isInUS, haversineKm, buildGeoJSON, cronIntervalMinutes,
  TTL, storeEvent, storeEvents,
  getActiveEvents, getAllActiveEvents,
  setLastUpdate, deleteWhereNoUSState, countActiveEvents
};
