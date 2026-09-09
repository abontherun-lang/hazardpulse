/**
 * NOAA Weather Alerts
 * Source: https://www.weather.gov/documentation/services-web-api
 * Format: GeoJSON (native, but ~95% of alerts lack geometry)
 * Auth: Requires User-Agent with contact info
 * Rate: No published limit. We poll every 15 min (NOAA recommended).
 *
 * Which alerts are shown is decided by alert-policy.js (every Warning except
 * marine products, plus an allow-list of watches and advisories). Alerts
 * without geometry are resolved to county polygons via SAME/FIPS codes
 * joined against TIGER county boundaries in PostGIS, then to a bundled
 * county centroid, then to the state centroid (geo.js).
 */

const axios = require('axios');
const { pool } = require('../db');
const { text, storeEvent, getActiveEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');
const { keepAlert, categoryFor } = require('./alert-policy');
const { sameCodesToPoint } = require('./geo');

const SOURCE_NAME = 'NOAA';
const CRON_SCHEDULE = '*/15 * * * *'; // every 15 minutes
const PREFIX = 'alert';
const URL = 'https://api.weather.gov/alerts/active';

/**
 * Resolve SAME/FIPS codes to a merged county polygon via TIGER boundaries.
 * Returns a GeoJSON geometry object, or null if no counties match.
 */
async function resolveCountyPolygons(sameCodes) {
  if (!sameCodes || sameCodes.length === 0) return null;

  const pairs = [];
  for (const code of sameCodes) {
    if (code.length !== 6) continue;
    const statefp = code.slice(1, 3);
    const countyfp = code.slice(3, 6);
    if (countyfp === '000') continue; // statewide — skip, too broad
    pairs.push({ statefp, countyfp });
  }
  if (pairs.length === 0) return null;

  // Build a merged, simplified polygon from all matching counties.
  // ST_Simplify(0.005) reduces vertices ~99% with no visible difference on a web map.
  const placeholders = pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
  const params = pairs.flatMap(p => [p.statefp, p.countyfp]);

  const result = await pool.query(`
    SELECT ST_AsGeoJSON(ST_Simplify(ST_Union(geom), 0.005))::json AS geometry
    FROM tiger_counties
    WHERE (statefp, countyfp) IN (${placeholders})
  `, params);

  return result.rows[0]?.geometry || null;
}

async function fetch() {
  console.log('\n🌩️  Fetching weather alerts from NOAA...');
  let response;
  try {
    response = await axios.get(URL, {
      headers: { 'User-Agent': process.env.USER_AGENT || '(HazardPulse/1.0, github.com/hazardpulse)' },
      timeout: 10000
    });
  } catch (e) {
    console.error(`   NOAA API error: ${e.message}`);
    throw e;
  }

  const allAlerts = response.data.features || [];
  console.log(`   Received ${allAlerts.length} total alerts`);

  const filtered = allAlerts.filter(a => keepAlert(a.properties));
  console.log(`   Kept ${filtered.length} by alert policy`);

  let stored = 0, polygonResolved = 0, centroidFallback = 0, fallbackRow = 0;
  for (const alert of filtered) {
    try {
      const id = alert.id || alert.properties.id;
      const props = alert.properties;

      // Resolve geometry (3-tier fallback):
      // 1. Use API-provided polygon (rare, ~5% of alerts)
      // 2. Build polygon from SAME/FIPS codes via TIGER county boundaries
      // 3. Fall back to a county or state centroid point
      let geometry = alert.geometry;
      const sameCodes = props.geocode && props.geocode.SAME ? props.geocode.SAME : [];

      if (!geometry || !geometry.type) {
        geometry = await resolveCountyPolygons(sameCodes);
        if (geometry) polygonResolved++;
      }
      if (!geometry) {
        geometry = sameCodesToPoint(sameCodes);
        if (geometry) centroidFallback++;
      }
      if (!geometry) continue;

      const event = text(props.event);
      const category = categoryFor(event);
      if (category !== event) fallbackRow++;

      const alertTime = props.effective || props.onset || props.sent || new Date().toISOString();
      const expiresAt = props.expires ? new Date(props.expires) : new Date(Date.now() + 3600000);
      const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));

      await storeEvent(SOURCE_NAME, id, {
        event,
        category,
        severity: text(props.severity) || 'Unknown',
        headline: text(props.headline),
        description: text(props.description),
        areaDesc: text(props.areaDesc),
        color: colorOf(category),
        sourceUrl: props['@id'] || '',
        timestamp: new Date(alertTime).getTime(),
        geometry,
        expires: props.expires || '',
        urgency: text(props.urgency),
        instruction: text(props.instruction).slice(0, 500)
      }, ttl);
      stored++;
    } catch (e) {
      console.warn(`   [NOAA] Skipped alert: ${e.message}`);
    }
  }

  console.log(`   ✓ Stored ${stored} weather alerts (${polygonResolved} county polygons, ${centroidFallback} centroid fallbacks, ${fallbackRow} in the fallback row)`);
  await setLastUpdate(SOURCE_NAME, stored);
  return { total: allAlerts.length, stored };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
