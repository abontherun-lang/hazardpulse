/**
 * NASA FIRMS Wildfire Detections
 * Source: https://firms.modaps.eosdis.nasa.gov/active_fire/
 * Format: CSV (direct download, no API key needed)
 * Auth: None for direct CSV
 * Rate: CSV updates ~hourly. Satellite passes every 3-6h. We poll every 3h.
 */

const axios = require('axios');
const { sanitize, isInUS, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'NASA FIRMS';
const CRON_SCHEDULE = '0 */3 * * *'; // every 3 hours
const PREFIX = 'fire';
const URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv';

function severity(frp) {
  if (frp >= 50) return { level: 'Extreme', color: '#BF360C' };
  if (frp >= 10) return { level: 'Severe', color: '#E65100' };
  if (frp >= 2)  return { level: 'Moderate', color: '#FF8F00' };
  return { level: 'Low', color: '#FFB74D' };
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
  if (typeof response.data !== 'string') {
    console.error('   FIRMS returned non-CSV response');
    throw new Error('FIRMS returned non-CSV response');
  }
  const lines = response.data.trim().split('\n');
  const rows = lines.slice(1); // skip CSV header
  console.log(`   Total fire detections: ${rows.length}`);

  const events = [];
  const seen = new Set();

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

    const frp = parseFloat(cols[11]);
    const acqDate = cols[5];
    const acqTime = cols[6];
    const daynight = cols[12];
    const sev = severity(frp);
    const id = `fire-${lat.toFixed(4)}-${lon.toFixed(4)}-${acqDate}`;
    const fireTs = new Date(`${acqDate}T${acqTime.slice(0,2)}:${acqTime.slice(2)}:00Z`).getTime() || Date.now();

    events.push({
      id,
      event: 'Wildfire',
      category: 'Wildfire',
      severity: sev.level,
      headline: sanitize(`Wildfire Detection — FRP ${frp.toFixed(1)} MW`),
      description: sanitize(`Acquired: ${acqDate} ${acqTime}UTC | ${daynight === 'D' ? 'Daytime' : 'Nighttime'} pass`),
      areaDesc: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      color: sev.color,
      lat,
      lon,
      timestamp: fireTs,
      frp: frp.toFixed(1),
      confidence: sanitize(confidence)
    });
  }

  await storeEvents(SOURCE_NAME, events, TTL.WILDFIRE);
  console.log(`   ✓ Stored ${events.length} wildfire detections`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: rows.length, stored: events.length };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
