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
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { sanitize, storeEvent, getActiveEvents, setLastUpdate } = require('./common');

// Load UGC centroids for fallback geocoding when TIGER lookup fails
let ugcCentroids = {};
try {
  ugcCentroids = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ugc_centroids.json'), 'utf-8'));
} catch (_) {}

// FIPS state codes to state abbreviations (for UGC key construction)
const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
  '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
  '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
  '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
  '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
  '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
  '55':'WI','56':'WY'
};

// State centroids for statewide alerts (county FIPS = 000)
const STATE_CENTROIDS = {
  'AL':[32.8,-86.8],'AK':[64.2,-152.5],'AZ':[34.0,-111.1],'AR':[34.8,-92.2],
  'CA':[36.8,-119.4],'CO':[39.0,-105.5],'CT':[41.6,-72.7],'DE':[39.0,-75.5],
  'DC':[38.9,-77.0],'FL':[27.8,-81.7],'GA':[32.7,-83.5],'HI':[19.9,-155.6],
  'ID':[44.1,-114.7],'IL':[40.3,-89.0],'IN':[40.3,-86.1],'IA':[42.0,-93.2],
  'KS':[38.5,-98.0],'KY':[37.8,-84.3],'LA':[30.5,-91.2],'ME':[45.3,-69.4],
  'MD':[39.0,-76.6],'MA':[42.4,-71.4],'MI':[44.3,-85.6],'MN':[46.4,-94.6],
  'MS':[32.7,-89.7],'MO':[38.5,-92.3],'MT':[46.8,-110.4],'NE':[41.1,-98.3],
  'NV':[38.8,-116.4],'NH':[43.2,-71.6],'NJ':[40.1,-74.5],'NM':[34.0,-105.9],
  'NY':[43.0,-75.5],'NC':[35.8,-79.0],'ND':[47.5,-100.5],'OH':[40.4,-82.9],
  'OK':[35.0,-97.1],'OR':[43.8,-120.6],'PA':[41.2,-77.2],'RI':[41.6,-71.5],
  'SC':[34.0,-81.0],'SD':[43.9,-99.9],'TN':[35.5,-86.0],'TX':[31.0,-100.0],
  'UT':[39.3,-111.1],'VT':[44.0,-72.7],'VA':[37.8,-78.2],'WA':[47.4,-120.7],
  'WV':[38.5,-80.5],'WI':[43.8,-89.5],'WY':[43.1,-107.6]
};

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

/**
 * Fallback: resolve SAME codes to a point via UGC centroids.
 * Uses the first code that matches. Returns a GeoJSON Point or null.
 */
function resolveUgcCentroid(sameCodes) {
  if (!sameCodes || sameCodes.length === 0) return null;

  for (const code of sameCodes) {
    if (code.length !== 6) continue;
    const stateFips = code.slice(1, 3);
    const countyFips = code.slice(3, 6);
    const state = FIPS_TO_STATE[stateFips];
    if (!state) continue;

    // County-level centroid
    if (countyFips !== '000') {
      const ugc = `${state}C${countyFips}`;
      const coords = ugcCentroids[ugc];
      if (coords) return { type: 'Point', coordinates: [coords[1], coords[0]] };
    }

    // Statewide alert — use state centroid
    const stateCoords = STATE_CENTROIDS[state];
    if (stateCoords) return { type: 'Point', coordinates: [stateCoords[1], stateCoords[0]] };
  }

  return null;
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

  let stored = 0, polygonResolved = 0, centroidFallback = 0;
  for (const alert of filtered) {
    try {
      const id = alert.id || alert.properties.id;
      const props = alert.properties;

      // Resolve geometry (3-tier fallback):
      // 1. Use API-provided polygon (rare, ~5% of alerts)
      // 2. Build polygon from SAME/FIPS codes via TIGER county boundaries
      // 3. Fall back to UGC centroid point (county or state level)
      let geometry = alert.geometry;
      const sameCodes = props.geocode && props.geocode.SAME ? props.geocode.SAME : [];

      if (!geometry || !geometry.type) {
        geometry = await resolveCountyPolygons(sameCodes);
        if (geometry) polygonResolved++;
      }

      if (!geometry) {
        geometry = resolveUgcCentroid(sameCodes);
        if (geometry) centroidFallback++;
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

  console.log(`   ✓ Stored ${stored} weather alerts (${polygonResolved} county polygons, ${centroidFallback} centroid fallbacks)`);
  await setLastUpdate(SOURCE_NAME, stored);
  return { total: allAlerts.length, stored };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
