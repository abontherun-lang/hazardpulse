/**
 * NIFC / WFIGS — Current Interagency Wildland Fire Incident Locations
 * Source: ArcGIS FeatureServer (WFIGS_Incident_Locations_Current)
 * Format: GeoJSON (f=geojson)
 * Auth: None
 * Rate: Incidents update ~hourly. We poll hourly.
 *
 * Authoritative, human-reported wildfires with name / acreage / containment.
 * Serves two roles:
 *   1. Its own map layer ('Wildfire Incident') — named fires.
 *   2. getActiveFirePoints() — corroborates NASA FIRMS satellite detections
 *      so persistent industrial/agricultural thermal sources are not shown as
 *      wildfires (see firms.js gating).
 */

const axios = require('axios');
const { sanitize, isInUS, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'NIFC';
const CRON_SCHEDULE = '15 * * * *'; // hourly, offset from FIRMS
const PREFIX = 'nifc';
const BASE = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const FIELDS = [
  'IncidentName', 'IncidentTypeCategory', 'IncidentSize', 'PercentContained',
  'FireCause', 'POOState', 'FireDiscoveryDateTime', 'FireOutDateTime',
  'IncidentShortDescription', 'IrwinID', 'UniqueFireIdentifier'
];
const RECENT_MS = 21 * 24 * 3600 * 1000; // 21 days

function severity(acres) {
  if (acres >= 5000) return { level: 'Extreme', color: '#7F0000' };
  if (acres >= 1000) return { level: 'Severe', color: '#B71C1C' };
  if (acres >= 100)  return { level: 'Moderate', color: '#D84315' };
  return { level: 'Low', color: '#EF6C00' };
}

// A WF incident counts as "active" (for display + corroboration) when it has
// not been declared out and is either uncontained or recently discovered.
// Prescribed burns (RX) are intentionally excluded — they are not wildfires.
function isActiveWF(a, now) {
  if (a.IncidentTypeCategory !== 'WF') return false;
  if (a.FireOutDateTime) return false;
  const pc = a.PercentContained;
  const disc = a.FireDiscoveryDateTime || 0;
  return (pc == null || pc < 100) || (disc && now - disc < RECENT_MS);
}

async function fetchRaw() {
  const qs = `where=${encodeURIComponent("IncidentTypeCategory='WF'")}` +
    `&outFields=${encodeURIComponent(FIELDS.join(','))}` +
    `&f=geojson&resultRecordCount=2000`;
  const res = await axios.get(`${BASE}?${qs}`, { timeout: 25000 });
  const feats = (res.data && res.data.features) || [];
  return feats.filter(f => f.geometry && Array.isArray(f.geometry.coordinates));
}

// Module-level cache shared between fetch() (display) and getActiveFirePoints()
// (corroboration) so a fetch cycle hits the ArcGIS endpoint at most once.
let _cache = { at: 0, points: [] };

async function fetch() {
  console.log('\n🔥 Fetching wildfire incidents from NIFC/WFIGS...');
  let feats;
  try {
    feats = await fetchRaw();
  } catch (e) {
    console.error(`   NIFC API error: ${e.message}`);
    throw e;
  }
  console.log(`   Total WF incidents: ${feats.length}`);

  const now = Date.now();
  const events = [];
  const points = [];

  for (const f of feats) {
    const a = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    if (!isInUS(lat, lon)) continue;
    if (!isActiveWF(a, now)) continue;

    const acres = a.IncidentSize || 0;
    points.push({ lat, lon, acres });

    const sev = severity(acres);
    const contained = a.PercentContained == null ? 'Unknown' : `${a.PercentContained}%`;
    const sizeStr = acres ? `${acres.toLocaleString()} ac` : 'size unknown';

    events.push({
      id: `nifc-${a.IrwinID || a.UniqueFireIdentifier || `${lat.toFixed(4)}-${lon.toFixed(4)}`}`,
      event: 'Wildfire Incident',
      category: 'Wildfire Incident',
      severity: sev.level,
      headline: sanitize(`${a.IncidentName || 'Unnamed'} — ${sizeStr}, ${contained} contained`),
      description: sanitize(a.IncidentShortDescription || ''),
      areaDesc: sanitize((a.POOState || '').replace('US-', '')),
      color: sev.color,
      lat,
      lon,
      timestamp: a.FireDiscoveryDateTime || now,
      acres,
      contained,
      cause: sanitize(a.FireCause || 'Unknown')
    });
  }

  _cache = { at: now, points };
  await storeEvents(SOURCE_NAME, events, TTL.NIFC);
  console.log(`   ✓ Stored ${events.length} active wildfire incidents`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: feats.length, stored: events.length };
}

/**
 * Active-fire points {lat, lon, acres} for FIRMS corroboration.
 * Cached (default 10 min) so the FIRMS gate reuses the latest fetch.
 */
async function getActiveFirePoints(maxAgeMs = 10 * 60 * 1000) {
  if (_cache.at && Date.now() - _cache.at < maxAgeMs) return _cache.points;
  try {
    const feats = await fetchRaw();
    const now = Date.now();
    _cache = {
      at: now,
      points: feats
        .filter(f => isInUS(f.geometry.coordinates[1], f.geometry.coordinates[0]) && isActiveWF(f.properties, now))
        .map(f => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          acres: f.properties.IncidentSize || 0
        }))
    };
  } catch (e) {
    console.warn(`   [nifc] getActiveFirePoints fetch failed, using stale (${_cache.points.length}): ${e.message}`);
  }
  return _cache.points;
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, getActiveFirePoints, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
