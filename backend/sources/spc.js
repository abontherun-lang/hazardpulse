/**
 * SPC Storm Reports — preliminary tornado reports
 * Source: https://www.spc.noaa.gov/ via NOAA ArcGIS FeatureServer
 * Format: ArcGIS JSON (points)
 * Auth: None
 * Rate: No published limit. We poll every 15 min.
 *
 * Layers:
 *   0 = Hail (24h)     1 = Tornado (24h)
 *   2 = Wind (24h)     3 = Tornado (past week)
 *   4 = All (past week)
 *
 * These are Local Storm Reports: a spotter, chaser or office saw a tornado
 * (or a landspout, or damage). They are preliminary — F_SCALE is null on
 * every row this layer has served (checked 2026-09-08). Rated damage
 * surveys come from the NWS Damage Assessment Toolkit (dat.js).
 */

const { http } = require('../http');
const { text, isInUS, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');

const SOURCE_NAME = 'SPC';
const CRON_SCHEDULE = '*/15 * * * *';
const PREFIX = 'spc';
const CATEGORY = 'Tornado Report';

const BASE_URL = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NOAA_storm_reports_v1/FeatureServer';
const TORNADO_LAYER = 3; // past week

/**
 * One ArcGIS report → event, or null if it has no usable position.
 * The id is time + location: OBJECTID is reassigned when the layer is
 * republished, which stored the same report several times.
 */
function normalizeReport(a, g) {
  if (!g || typeof g.y !== 'number' || typeof g.x !== 'number') return null;
  const lat = g.y, lon = g.x;
  if (!isInUS(lat, lon)) return null;

  const when = Number(a.UTC_DATETIME) || Date.now();
  const location = [a.LOCATION, a.COUNTY, a.STATE].filter(Boolean).join(', ');
  const rating = a.F_SCALE ? text(a.F_SCALE) : null;

  return {
    id: `spc-tornado-${when}-${lat.toFixed(2)}-${lon.toFixed(2)}`,
    event: CATEGORY,
    category: CATEGORY,
    severity: 'Severe',
    headline: `Tornado reported — ${location || 'location unknown'}`,
    description: text(a.COMMENTS),
    areaDesc: text(location),
    color: colorOf(CATEGORY),
    sourceUrl: 'https://www.spc.noaa.gov/climo/reports/today.html',
    timestamp: when,
    lat,
    lon,
    preliminary: true,
    ...(rating && { rating })
  };
}

async function fetch() {
  console.log('\n🌪️  Fetching SPC tornado reports...');
  let response;
  try {
    response = await http.get(`${BASE_URL}/${TORNADO_LAYER}/query`, {
      params: { where: '1=1', outFields: '*', resultRecordCount: 500, f: 'json', outSR: 4326 },
      timeout: 15000
    });
  } catch (e) {
    console.error(`   SPC API error: ${e.message}`);
    throw e;
  }

  const features = response.data.features || [];
  console.log(`   Tornado reports (past week): ${features.length}`);

  const events = features.map(f => normalizeReport(f.attributes || {}, f.geometry)).filter(Boolean);

  await storeEvents(SOURCE_NAME, events, TTL.TORNADO);
  console.log(`   ✓ Stored ${events.length} preliminary tornado reports`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: features.length, stored: events.length };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX, normalizeReport };
