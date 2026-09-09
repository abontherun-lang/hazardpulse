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
 * their own layer; getElevatedPoints() also lets the FIRMS gate attribute
 * volcanic thermal anomalies to the volcano instead of calling them wildfires.
 */

const axios = require('axios');
const { text, sanitizeUrl, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'USGS Volcano';
const CRON_SCHEDULE = '0 * * * *'; // hourly
const PREFIX = 'volcano';
const URL = 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson';

const COLOR = { RED: '#B71C1C', ORANGE: '#E65100', YELLOW: '#F9A825' };
const SEV   = { RED: 'Extreme', ORANGE: 'Severe', YELLOW: 'Moderate' };

function isElevated(p) {
  const a = (p.alertLevel || '').toUpperCase();
  const c = (p.colorCode || '').toUpperCase();
  return a && a !== 'NORMAL' && a !== 'UNASSIGNED' && c !== 'GREEN' && c !== '';
}

async function fetchRaw() {
  const res = await axios.get(URL, { timeout: 20000 });
  const feats = (res.data && res.data.features) || [];
  return feats.filter(f => f.geometry && Array.isArray(f.geometry.coordinates) && isElevated(f.properties));
}

let _cache = { at: 0, points: [] };

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
  const points = [];

  for (const f of elevated) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const code = (p.colorCode || '').toUpperCase();
    points.push({ lat, lon });

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

  _cache = { at: Date.now(), points };
  await storeEvents(SOURCE_NAME, events, TTL.VOLCANO);
  console.log(`   ✓ Stored ${events.length} elevated volcanoes`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: elevated.length, stored: events.length };
}

/**
 * Elevated-volcano coordinates {lat, lon} for the FIRMS suppression check.
 * Cached (default 10 min) so the FIRMS gate reuses the latest fetch.
 */
async function getElevatedPoints(maxAgeMs = 10 * 60 * 1000) {
  if (_cache.at && Date.now() - _cache.at < maxAgeMs) return _cache.points;
  try {
    const elevated = await fetchRaw();
    _cache = {
      at: Date.now(),
      points: elevated.map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }))
    };
  } catch (e) {
    console.warn(`   [volcano] getElevatedPoints fetch failed, using stale (${_cache.points.length}): ${e.message}`);
  }
  return _cache.points;
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, getElevatedPoints, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
