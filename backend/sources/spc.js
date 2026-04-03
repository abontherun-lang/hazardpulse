/**
 * SPC Storm Reports — Tornado, Hail, and Wind damage reports
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
 * We pull tornado reports (past week) — these are post-event NWS damage
 * surveys with EF ratings, path descriptions, and damage narratives.
 */

const axios = require('axios');
const { sanitize, isInUS, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'SPC';
const CRON_SCHEDULE = '*/15 * * * *';
const PREFIX = 'spc';

const BASE_URL = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NOAA_storm_reports_v1/FeatureServer';

// Layer 3 = tornado reports (past week), Layer 1 = tornado (24h)
// We use the weekly layer for broader coverage
const TORNADO_LAYER = 3;

function severity(efScale) {
  if (!efScale) return { level: 'Severe', color: '#0D47A1' };
  const ef = parseInt(efScale.replace(/\D/g, '')) || 0;
  if (ef >= 4) return { level: 'Extreme', color: '#1A237E' };
  if (ef >= 3) return { level: 'Extreme', color: '#0D47A1' };
  if (ef >= 2) return { level: 'Severe', color: '#1565C0' };
  if (ef >= 1) return { level: 'Severe', color: '#1976D2' };
  return { level: 'Moderate', color: '#42A5F5' };
}

async function fetch() {
  console.log('\n🌪️  Fetching SPC tornado reports...');
  let response;
  try {
    response = await axios.get(`${BASE_URL}/${TORNADO_LAYER}/query`, {
      params: {
        where: '1=1',
        outFields: '*',
        resultRecordCount: 500,
        f: 'json',
        outSR: 4326
      },
      timeout: 15000
    });
  } catch (e) {
    console.error(`   SPC API error: ${e.message}`);
    throw e;
  }

  const features = response.data.features || [];
  console.log(`   Tornado reports (past week): ${features.length}`);

  const events = [];
  for (const f of features) {
    const a = f.attributes;
    const g = f.geometry;
    if (!g || !g.y || !g.x) continue;

    const lat = g.y;
    const lon = g.x;
    if (!isInUS(lat, lon)) continue;

    const sev = severity(a.F_SCALE);
    const efLabel = a.F_SCALE ? `EF${a.F_SCALE.replace(/\D/g, '')}` : 'Survey Pending';
    const location = [a.LOCATION, a.COUNTY, a.STATE].filter(Boolean).join(', ');
    const id = `spc-tornado-${a.OBJECTID || `${lat.toFixed(4)}-${lon.toFixed(4)}-${a.UTC_DATETIME}`}`;

    events.push({
      id,
      event: 'Tornado Report',
      category: 'Tornado Report',
      severity: sev.level,
      headline: sanitize(`${efLabel} Tornado — ${location}`),
      description: sanitize(a.COMMENTS || ''),
      areaDesc: sanitize(location),
      color: sev.color,
      sourceUrl: 'https://www.spc.noaa.gov/climo/reports/today.html',
      timestamp: a.UTC_DATETIME || Date.now(),
      lat,
      lon,
      efScale: efLabel
    });
  }

  await storeEvents(SOURCE_NAME, events, TTL.TORNADO);
  console.log(`   ✓ Stored ${events.length} tornado reports`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: features.length, stored: events.length };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
