/**
 * NWS Damage Assessment Toolkit — surveyed tornado tracks with EF ratings
 * Source: https://apps.dat.noaa.gov/stormdamage/damageviewer/
 * Endpoint: ArcGIS MapServer, layer 1 "Damage Lines" (f=geojson)
 * Format: GeoJSON LineString per surveyed track
 * Auth: None
 * Rate: Surveys land hours to days after a storm. We poll hourly.
 *
 * This is the post-event product: an NWS office walked the path and
 * assigned an EF rating, length, width, injuries and fatalities. SPC's
 * layer (spc.js) is the preliminary "someone saw a tornado" report.
 *
 * The service holds every survey since 2010, offices re-edit old ones
 * (Ohatchee 2021 was edited in June 2026), and a query capped at 2000 rows
 * filled up with 14 days of edits. So the query filters on the storm date
 * (falling back to the start time) and the code checks it again.
 */

const { http } = require('../http');
const { text, TTL, storeEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');

const SOURCE_NAME = 'NWS DAT';
const CRON_SCHEDULE = '30 * * * *'; // hourly, offset from the other hourly sources
const PREFIX = 'dat';
const CATEGORY = 'Tornado Damage Survey';
const URL = 'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/MapServer/1/query';
const RECENT_MS = 14 * 24 * 3600 * 1000;
const FIELDS = ['event_id', 'stormdate', 'starttime', 'endtime', 'efscale', 'efnum', 'length', 'width',
  'injuries', 'fatalities', 'maxwind', 'wfo', 'comments', 'created_date', 'last_edited_date', 'globalid'];

// Track color by rating; the legend swatch is the EF2 tone.
const EF_COLORS = ['#90CAF9', '#42A5F5', '#1E88E5', '#1565C0', '#0D47A1', '#311B92'];

function severity(efnum) {
  if (efnum >= 4) return 'Extreme';
  if (efnum >= 2) return 'Severe';
  return 'Moderate';
}

function arcgisTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * One GeoJSON feature → event, or null when it is not a recent track.
 * event_time is the survey's publish/edit time so a newly rated tornado
 * shows inside the rolling display window; the storm date is a prop.
 */
function normalizeSurvey(feature, now = Date.now()) {
  const p = feature.properties || {};
  const g = feature.geometry;
  if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;

  const stormTime = Number(p.stormdate) || Number(p.starttime) || 0;
  if (!stormTime || now - stormTime > RECENT_MS) return null;

  // efnum is -1 for "EFU" (unknown) in the service; treat that as unrated.
  let efnum = Number.isInteger(p.efnum) ? p.efnum : parseInt(String(p.efscale || '').replace(/\D/g, ''));
  if (!Number.isInteger(efnum) || efnum < 0) efnum = null;
  // The layer also carries straight-line wind damage paths ("TSTM/Wind");
  // only tornado tracks (EF0–EF5, or EFU for unknown) belong on this layer.
  if (efnum === null && !/^EF/i.test(String(p.efscale || ''))) return null;
  const rating = efnum !== null ? `EF${efnum}` : (text(p.efscale) || 'Unrated');
  const published = Number(p.last_edited_date) || Number(p.created_date) || stormTime;
  // event_id is a name ("Hammond, LA Tornado") for some offices, a bare number or null for others.
  const rawName = text(p.event_id);
  const name = /[a-zA-Z]/.test(rawName) ? rawName : `Tornado${p.wfo ? ` (NWS ${text(p.wfo)})` : ''}`;
  const lengthMi = typeof p.length === 'number' ? Number(p.length.toFixed(1)) : null;
  const widthYd = typeof p.width === 'number' ? Math.round(p.width) : null;

  return {
    id: `dat-${text(p.globalid) || `${stormTime}-${g.coordinates[0].join(',')}`}`,
    event: CATEGORY,
    category: CATEGORY,
    severity: severity(efnum),
    headline: `${rating} — ${name}`,
    description: text(p.comments),
    areaDesc: text(p.wfo ? `NWS ${p.wfo}` : ''),
    color: efnum !== null ? EF_COLORS[Math.min(efnum, 5)] : colorOf(CATEGORY),
    sourceUrl: 'https://apps.dat.noaa.gov/stormdamage/damageviewer/',
    timestamp: published,
    geometry: g,
    rating,
    efnum,
    stormDate: stormTime,
    lengthMi,
    widthYd,
    injuries: p.injuries ?? null,
    fatalities: p.fatalities ?? null,
    maxWindMph: p.maxwind ?? null,
    wfo: text(p.wfo)
  };
}

async function fetch() {
  console.log('\n🌪️  Fetching NWS damage surveys (DAT)...');
  const now = Date.now();
  const since = arcgisTimestamp(now - RECENT_MS);
  const qs = `where=${encodeURIComponent(`stormdate >= TIMESTAMP '${since}' OR starttime >= TIMESTAMP '${since}'`)}` +
    `&outFields=${encodeURIComponent(FIELDS.join(','))}&orderByFields=last_edited_date%20DESC` +
    `&resultRecordCount=2000&f=geojson`;

  let response;
  try {
    response = await http.get(`${URL}?${qs}`, { timeout: 25000 });
  } catch (e) {
    console.error(`   DAT API error: ${e.message}`);
    throw e;
  }
  if (response.data && response.data.error) {
    throw new Error(`DAT query error: ${JSON.stringify(response.data.error).slice(0, 200)}`);
  }

  const feats = (response.data && response.data.features) || [];
  const events = feats.map(f => normalizeSurvey(f, now)).filter(Boolean);
  console.log(`   Surveyed tracks, storms in last 14d: ${feats.length} (${events.length} usable)`);

  await storeEvents(SOURCE_NAME, events, TTL.SURVEY);
  console.log(`   ✓ Stored ${events.length} tornado damage surveys`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: feats.length, stored: events.length };
}

module.exports = { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX, normalizeSurvey, severity };
