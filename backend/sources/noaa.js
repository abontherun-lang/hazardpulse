/**
 * NOAA Weather Alerts
 * Source: https://www.weather.gov/documentation/services-web-api
 * Format: GeoJSON (native, but ~95% of alerts lack geometry)
 * Auth: Requires User-Agent with contact info
 * Rate: No published limit. We poll every 15 min (NOAA recommended).
 *
 * Alerts without geometry are resolved to county polygons via SAME/FIPS codes
 * joined against TIGER county boundaries in PostGIS. Multiple counties are
 * merged into a single MultiPolygon with ST_Union.
 */

const axios = require('axios');
const { pool } = require('../db');
const { sanitize, storeEvent, getActiveEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'NOAA';
const CRON_SCHEDULE = '*/15 * * * *'; // every 15 minutes
const PREFIX = 'alert';
const URL = 'https://api.weather.gov/alerts/active';

const TARGET_EVENTS = [
  'Tornado Warning', 'Tornado Watch',
  'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
  'Flood Warning', 'Flood Watch',
  'Red Flag Warning', 'Fire Weather Watch',
  'Hurricane Warning', 'Hurricane Watch',
  'Tropical Storm Warning', 'Tropical Storm Watch',
  'Storm Surge Warning', 'Storm Surge Watch',
  'Tsunami Warning', 'Tsunami Watch', 'Tsunami Advisory',
  'Earthquake Warning',
  'Special Weather Statement', 'Winter Weather Advisory', 'Wind Advisory'
];

const ALERT_COLORS = {
  'Tornado Warning': '#0D47A1', 'Tornado Watch': '#1565C0',
  'Severe Thunderstorm Warning': '#1976D2', 'Severe Thunderstorm Watch': '#42A5F5',
  'Special Weather Statement': '#546E7A', 'Winter Weather Advisory': '#78909C', 'Wind Advisory': '#607D8B',
  'Flood Warning': '#1A237E', 'Flood Watch': '#3949AB',
  'Red Flag Warning': '#E65100', 'Fire Weather Watch': '#FF8F00',
  'Hurricane Warning': '#006064', 'Hurricane Watch': '#00838F',
  'Tropical Storm Warning': '#0097A7', 'Tropical Storm Watch': '#26C6DA',
  'Storm Surge Warning': '#004D40', 'Storm Surge Watch': '#00897B',
  'Tsunami Warning': '#01579B', 'Tsunami Watch': '#0277BD', 'Tsunami Advisory': '#0288D1',
  'Earthquake Warning': '#795548'
};

/**
 * Resolve SAME/FIPS codes to a merged county polygon via TIGER boundaries.
 * SAME code format: 0SSCCC (leading 0 + 2-digit state FIPS + 3-digit county FIPS)
 * Returns a GeoJSON geometry object, or null if no counties match.
 */
async function resolveCountyPolygons(sameCodes) {
  if (!sameCodes || sameCodes.length === 0) return null;

  // Parse SAME codes into (statefp, countyfp) pairs
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

  const filtered = allAlerts.filter(a => TARGET_EVENTS.includes(a.properties.event));
  console.log(`   Filtered to ${filtered.length} relevant alerts`);

  let stored = 0, polygonResolved = 0;
  for (const alert of filtered) {
    try {
      const id = alert.id || alert.properties.id;
      const props = alert.properties;

      // Resolve geometry:
      // 1. Use API-provided polygon (rare, ~5% of alerts)
      // 2. Build polygon from SAME/FIPS codes via TIGER county boundaries
      let geometry = alert.geometry;
      const sameCodes = props.geocode && props.geocode.SAME ? props.geocode.SAME : [];

      if (!geometry || !geometry.type) {
        geometry = await resolveCountyPolygons(sameCodes);
        if (geometry) polygonResolved++;
      }

      if (!geometry) continue;

      const alertTime = props.effective || props.onset || props.sent || new Date().toISOString();
      const expiresAt = props.expires ? new Date(props.expires) : new Date(Date.now() + 3600000);
      const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));

      await storeEvent(SOURCE_NAME, id, {
        event: sanitize(props.event),
        category: sanitize(props.event),
        severity: sanitize(props.severity) || 'Unknown',
        headline: sanitize(props.headline),
        description: sanitize(props.description),
        areaDesc: sanitize(props.areaDesc),
        color: ALERT_COLORS[props.event] || '#808080',
        sourceUrl: props['@id'] || '',
        timestamp: new Date(alertTime).getTime(),
        geometry,
        expires: props.expires || ''
      }, ttl);
      stored++;
    } catch (e) {
      console.warn(`   [NOAA] Skipped alert: ${e.message}`);
    }
  }

  console.log(`   ✓ Stored ${stored} weather alerts (${polygonResolved} resolved to county polygons)`);
  await setLastUpdate(SOURCE_NAME, stored);
  return { total: allAlerts.length, stored };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
