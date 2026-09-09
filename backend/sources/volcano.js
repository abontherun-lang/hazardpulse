/**
 * USGS Volcano Hazards Program — elevated US volcanoes
 * Source: https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson
 * Format: GeoJSON (native)
 * Auth: None
 * Rate: Alert levels change infrequently. We poll hourly.
 *
 * One call returns every US volcano with coordinates plus the current
 * alertLevel / colorCode. We surface only those above NORMAL/GREEN — i.e.
 * actively unsettled. Active volcanoes are legitimate hazards, so they get
 * their own layer; firms.js also reads the stored rows
 * (getActivePoints('USGS Volcano')) to attribute volcanic thermal anomalies
 * to the volcano instead of calling them wildfires.
 */

const { http } = require('../http');
const { text, sanitizeUrl, TTL, storeEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'USGS Volcano';
const CRON_SCHEDULE = '0 * * * *'; // hourly
const PREFIX = 'volcano';
const URL = 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson';

const COLOR = { RED: '#B71C1C', ORANGE: '#E65100', YELLOW: '#F9A825' };
const SEV   = { RED: 'Extreme', ORANGE: 'Severe', YELLOW: 'Moderate' };

function isElevated(p) {
  const a = (p.alertLevel || '').toUpperCase();
  const c = (p.colorCode || '').toUpperCase();
  return Boolean(a) && a !== 'NORMAL' && a !== 'UNASSIGNED' && c !== 'GREEN' && c !== '';
}

async function fetchRaw() {
  const res = await http.get(URL, { timeout: 20000 });
  const feats = (res.data && res.data.features) || [];
  return feats.filter(f => f.geometry && Array.isArray(f.geometry.coordinates) && isElevated(f.properties));
}

async function fetch() {
  console.log('\n🌋 Fetching elevated volcanoes from USGS...');
  let elevated;
  try {
    elevated = await fetchRaw();
  } catch (e) {
    console.error(`   USGS Volcano API error: ${e.message}`);
    throw e;
  }
  console.log(`   Elevated US volcanoes: ${elevated.length}`);

  const events = [];

  for (const f of elevated) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const code = (p.colorCode || '').toUpperCase();

    events.push({
      id: `volcano-${p.vnum}`,
      event: 'Volcano',
      category: 'Volcano',
      severity: SEV[code] || 'Moderate',
      headline: text(`${p.volcanoName} — ${p.alertLevel} / ${p.colorCode}`),
      description: text(p.noticeSynopsis || `Aviation color code ${p.colorCode}, alert level ${p.alertLevel}.`),
      areaDesc: text(p.region || ''),
      color: COLOR[code] || '#F9A825',
      lat,
      lon,
      sourceUrl: sanitizeUrl(p.noticeUrl || p.volcanoUrl),
      timestamp: Date.now(),
      alertLevel: text(p.alertLevel || ''),
      colorCode: text(p.colorCode || ''),
      observatory: text(p.obs || '')
    });
  }

  await storeEvents(SOURCE_NAME, events, TTL.VOLCANO);
  console.log(`   ✓ Stored ${events.length} elevated volcanoes`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: elevated.length, stored: events.length };
}

module.exports = { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX, isElevated };
