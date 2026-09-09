/**
 * NASA FIRMS Wildfire Detections
 * Source: https://firms.modaps.eosdis.nasa.gov/active_fire/
 * Format: CSV (direct download, no API key needed)
 * Auth: None for direct CSV
 * Rate: CSV updates ~hourly. Satellite passes every 3-6h. We poll every 3h.
 *
 * VIIRS reports *thermal anomalies*, not wildfires — the raw feed is dominated
 * by persistent industrial sources (steel mills, refineries, gas flares),
 * agricultural burns, volcanoes, and foreign hits that leak through the US
 * bounding box. To suppress those false positives a detection is shown only if:
 *   1. it is NOT next to an elevated volcano (those go on the volcano layer), and
 *   2. it is intense enough to be unmistakably a fire (FRP >= FIRE_AUTOADMIT_FRP),
 *      OR it is corroborated by a nearby active NIFC wildfire incident.
 * A post-store TIGER prune drops anything that doesn't fall in a US state.
 */

const axios = require('axios');
const {
  text, isInUS, haversineKm,
  TTL, storeEvents, getActiveEvents, setLastUpdate, deleteWhereNoUSState, countActiveEvents
} = require('./common');
const nifc = require('./nifc');
const volcano = require('./volcano');

const SOURCE_NAME = 'NASA FIRMS';
const CRON_SCHEDULE = '0 */3 * * *'; // every 3 hours
const PREFIX = 'fire';
const URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv';

// Tunable gate parameters (env-overridable).
const AUTOADMIT_FRP   = parseFloat(process.env.FIRE_AUTOADMIT_FRP) || 50;        // MW: auto-admit obvious fires
const CORR_GEOREF_KM  = parseFloat(process.env.FIRE_CORROBORATE_GEOREF_KM) || 2; // VIIRS georeferencing tolerance
const CORR_MAX_KM     = parseFloat(process.env.FIRE_CORROBORATE_MAX_KM) || 15;   // cap on size-scaled radius
const VOLCANO_SUPPRESS_KM = parseFloat(process.env.VOLCANO_SUPPRESS_KM) || 20;   // radius attributed to a volcano

function severity(frp) {
  if (frp >= 50) return { level: 'Extreme', color: '#BF360C' };
  if (frp >= 10) return { level: 'Severe', color: '#E65100' };
  if (frp >= 2)  return { level: 'Moderate', color: '#FF8F00' };
  return { level: 'Low', color: '#FFB74D' };
}

// Corroboration radius scales with fire size: a georeferencing tolerance plus
// the radius of an equal-area circle for the reported acreage (capped). This
// stops a sub-acre brush fire from validating a persistent industrial hotspot
// kilometres away, while a large fire still validates its whole footprint.
function corrRadiusKm(acres) {
  const eqKm = Math.sqrt(Math.max(acres, 0) * 4046.86 / Math.PI) / 1000; // 4046.86 m²/acre
  return Math.min(CORR_GEOREF_KM + eqKm, CORR_MAX_KM);
}

function nearVolcano(lat, lon, volcs) {
  for (const v of volcs) {
    if (Math.abs(v.lat - lat) > 0.6 || Math.abs(v.lon - lon) > 0.6) continue; // cheap bbox reject
    if (haversineKm(lat, lon, v.lat, v.lon) <= VOLCANO_SUPPRESS_KM) return true;
  }
  return false;
}

function nearActiveFire(lat, lon, fires) {
  for (const f of fires) {
    if (Math.abs(f.lat - lat) > 0.6 || Math.abs(f.lon - lon) > 0.6) continue; // cheap bbox reject
    if (haversineKm(lat, lon, f.lat, f.lon) <= corrRadiusKm(f.acres)) return true;
  }
  return false;
}

/**
 * Parse the FIRMS CSV and apply the admission gates. Pure — corroboration
 * inputs (active NIFC fires, elevated volcanoes) are passed in, nothing is
 * fetched or stored. Throws if the payload isn't FIRMS CSV: NASA serves HTML
 * error/maintenance pages with HTTP 200, which would otherwise parse as
 * garbage rows.
 */
function parseDetections(csvText, fires = [], volcs = []) {
  if (typeof csvText !== 'string') {
    throw new Error('FIRMS returned non-CSV response');
  }
  const lines = csvText.trim().split('\n');
  if (!lines[0] || !lines[0].includes('latitude') || !lines[0].includes('frp')) {
    throw new Error('FIRMS response missing CSV header');
  }
  const rows = lines.slice(1);

  const events = [];
  const seen = new Set();
  let admitFrp = 0, admitNifc = 0, dropVolcano = 0, dropUncorroborated = 0;

  for (const line of rows) {
    const cols = line.split(',');
    const lat = parseFloat(cols[0]);
    const lon = parseFloat(cols[1]);
    if (isNaN(lat) || isNaN(lon)) continue;
    if (!isInUS(lat, lon)) continue;

    const confidence = cols[8];
    if (confidence === 'low') continue;

    const dedupKey = `${lat.toFixed(2)}-${lon.toFixed(2)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const frp = parseFloat(cols[11]) || 0;

    // Volcanic thermal anomalies belong on the dedicated volcano layer.
    if (nearVolcano(lat, lon, volcs)) { dropVolcano++; continue; }

    // Gate: unmistakable intensity OR corroborated by an active NIFC incident.
    let basis;
    if (frp >= AUTOADMIT_FRP) { basis = 'high-intensity'; admitFrp++; }
    else if (nearActiveFire(lat, lon, fires)) { basis = 'nifc-confirmed'; admitNifc++; }
    else { dropUncorroborated++; continue; }

    const acqDate = cols[5];
    const acqTime = cols[6];
    const daynight = cols[12];
    const sev = severity(frp);
    const id = `fire-${lat.toFixed(4)}-${lon.toFixed(4)}-${acqDate}`;
    const fireTs = new Date(`${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`).getTime() || Date.now();

    events.push({
      id,
      event: 'Wildfire',
      category: 'Wildfire',
      severity: sev.level,
      headline: text(`Active Fire — FRP ${frp.toFixed(1)} MW`),
      description: text(
        `Acquired ${acqDate} ${acqTime}UTC | ${daynight === 'D' ? 'Daytime' : 'Nighttime'} pass | ` +
        (basis === 'high-intensity' ? 'High-intensity detection' : 'Confirmed by nearby NIFC incident')
      ),
      areaDesc: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      color: sev.color,
      lat,
      lon,
      timestamp: fireTs,
      frp: frp.toFixed(1),
      confidence: text(confidence),
      basis
    });
  }

  return { total: rows.length, events, admitFrp, admitNifc, dropVolcano, dropUncorroborated };
}

async function fetch() {
  console.log('\n🔥 Fetching wildfire data from NASA FIRMS...');
  let response;
  try {
    response = await axios.get(URL, { timeout: 30000 });
  } catch (e) {
    console.error(`   FIRMS API error: ${e.message}`);
    throw e;
  }

  // Corroboration inputs. If either source is unavailable we degrade
  // gracefully: an empty volcano list suppresses nothing; an empty fire list
  // means only the FRP auto-admit path can pass.
  let fires = [], volcs = [];
  try { fires = await nifc.getActiveFirePoints(); }
  catch (e) { console.warn(`   [firms] NIFC corroboration unavailable: ${e.message}`); }
  try { volcs = await volcano.getElevatedPoints(); }
  catch (e) { console.warn(`   [firms] volcano list unavailable: ${e.message}`); }

  const { total, events, admitFrp, admitNifc, dropVolcano, dropUncorroborated } =
    parseDetections(response.data, fires, volcs);
  console.log(`   Total fire detections: ${total}`);

  await storeEvents(SOURCE_NAME, events, TTL.WILDFIRE);

  // Precise US border backstop: drop any FIRMS row (this cycle or older) that
  // didn't land in a US state. This is a global cleanup, so its count is not
  // subtracted from this cycle's admits — we report the active total instead.
  let pruned = 0;
  try { pruned = await deleteWhereNoUSState(SOURCE_NAME); }
  catch (e) { console.warn(`   [firms] US-state prune failed: ${e.message}`); }

  let active = events.length;
  try { active = await countActiveEvents(SOURCE_NAME); }
  catch (e) { console.warn(`   [firms] active-count failed: ${e.message}`); }

  console.log(
    `   ✓ Admitted ${events.length} this cycle ` +
    `(FRP>=${AUTOADMIT_FRP}: ${admitFrp}, NIFC: ${admitNifc}) | ` +
    `dropped volcano ${dropVolcano}, uncorroborated ${dropUncorroborated}, foreign-pruned ${pruned} | ${active} active total`
  );
  await setLastUpdate(SOURCE_NAME, active);
  return { total, admitted: events.length, active, admitFrp, admitNifc, dropVolcano, dropUncorroborated, pruned };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX, parseDetections, corrRadiusKm, severity };
