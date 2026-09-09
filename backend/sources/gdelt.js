/**
 * GDELT Project — Violence & Unrest Events
 * Source: http://data.gdeltproject.org/gdeltv2/
 * Format: Tab-delimited CSV in ZIP files (published every 15 min)
 * Auth: None (public domain)
 * Rate: No limit on file downloads. We poll every 15 min.
 *
 * Noise reduction: Dropped CAMEO root 17 (Coerce/Threaten),
 * dropped codes 190/192/193/194/195/182, require NumArticles >= 3.
 * See docs/gdelt-filtering.md for rationale.
 */

const { http } = require('../http');
const AdmZip = require('adm-zip');
const {
  text, sanitizeUrl, isInUS, TTL, storeEvents,
  setLastUpdate, deleteWhereNoUSState
} = require('./common');
const { colorOf } = require('../layers');

const SOURCE_NAME = 'GDELT';
const CRON_SCHEDULE = '*/15 * * * *'; // every 15 minutes
const PREFIX = 'gdelt';

// CAMEO root codes we accept, with the map category (a layers.json type)
// used when the event code is not in ARMED_CODES / FORCE_CODES.
const ROOT_CODES = {
  '14': { label: 'Protest' },
  '18': { label: 'Use of Force' },
  '19': { label: 'Armed Violence' },
  '20': { label: 'Use of Force' }
};

const EVENT_LABELS = {
  '140': 'Protest', '141': 'Demonstrate', '142': 'Hunger Strike',
  '143': 'Strike / Boycott', '144': 'Obstruct Passage', '145': 'Violent Protest / Riot',
  '180': 'Use Conventional Force', '181': 'Coerce', '183': 'Assault',
  '184': 'Abduct / Hijack', '185': 'Destroy Property', '186': 'Armed Attack',
  '191': 'Gunfire',
  '200': 'Mass Violence', '201': 'Mass Killing', '202': 'Ethnic Cleansing', '203': 'Forced Disappearance'
};

// Dropped codes: 190 (Unconventional Force), 193 (Suicide Attack), 194 (WMD),
// 195 (Biological Attack), 182 (Seize/Control), 192 (Bombing — 99%+ false positives
// in US news context; NLP misreads "bombshell", "bombing run" in football, etc.)
const DROP_CODES = new Set(['190', '192', '193', '194', '195', '182']);
const ARMED_CODES = new Set(['186', '191', '185']);
const FORCE_CODES = new Set(['180', '181', '183', '184', '200', '201', '202', '203']);

// FIPS 10-4 country codes (GDELT's ActionGeo_CountryCode) for the US and its
// territories. RQ=Puerto Rico, GQ=Guam, VQ=USVI, AQ=American Samoa, CQ=N. Marianas.
const US_COUNTRY_CODES = new Set(['US', 'RQ', 'GQ', 'VQ', 'AQ', 'CQ']);

function getExportUrls(hoursBack) {
  const urls = [];
  const now = new Date();
  now.setMinutes(Math.floor(now.getMinutes() / 15) * 15, 0, 0);
  const intervals = (hoursBack * 60) / 15;
  for (let i = 0; i < intervals; i++) {
    const t = new Date(now.getTime() - i * 15 * 60 * 1000);
    const ts = t.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    urls.push(`http://data.gdeltproject.org/gdeltv2/${ts}.export.CSV.zip`);
  }
  return urls;
}

function parseCsv(csvData, fileTimestamp) {
  const rows = csvData.trim().split('\n').map(line => line.split('\t'));
  const events = [];
  const cutoff72h = Date.now() - (72 * 60 * 60 * 1000);

  for (const row of rows) {
    if (row.length < 61) continue;
    const rootCode = row[28];
    if (!ROOT_CODES[rootCode]) continue;
    const eventCode = row[26];
    if (DROP_CODES.has(eventCode)) continue;

    // Confidence filter: require multi-source confirmation (3+ articles)
    const numArticles = parseInt(row[33]) || 0;
    if (numArticles < 3) continue;

    const dateStr = row[1];
    if (dateStr && dateStr.length === 8) {
      const eventDate = new Date(dateStr.slice(0,4) + '-' + dateStr.slice(4,6) + '-' + dateStr.slice(6,8)).getTime();
      if (eventDate < cutoff72h) continue;
    }

    const lat = parseFloat(row[56]);
    const lon = parseFloat(row[57]);
    if (isNaN(lat) || isNaN(lon)) continue;

    // US filter. The bbox is coarse (southern Canada / northern Mexico fall
    // inside it), so an explicit foreign country code wins over coordinates;
    // the bbox is only a fallback for rows GDELT didn't geocode to a country.
    // A TIGER state-join prune after storage catches what's left.
    const country = row[53];
    if (country && !US_COUNTRY_CODES.has(country)) continue;
    if (!country && !isInUS(lat, lon)) continue;

    events.push({
      id: `gdelt-${row[0]}`, rootCode, eventCode,
      lat, lon, geo: row[52], sourceUrl: row[60] || '',
      date: dateStr, numArticles, fileTimestamp: fileTimestamp || Date.now()
    });
  }
  return events;
}

async function fetchSingleFile(url) {
  try {
    const match = url.match(/(\d{14})\.export/);
    let fileTs = Date.now();
    if (match) {
      const ts = match[1];
      fileTs = new Date(`${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}Z`).getTime();
    }
    const response = await http.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const zip = new AdmZip(Buffer.from(response.data));
    const entry = zip.getEntries().find(e => e.entryName.endsWith('.export.CSV'));
    if (!entry) return [];
    return parseCsv(entry.getData().toString('utf-8'), fileTs);
  } catch (error) {
    if (error.response && error.response.status === 404) return [];
    throw error;
  }
}

async function fetch(hoursBack = 0.25) {
  console.log(`\n📰 Fetching GDELT events (last ${hoursBack}h, US only)...`);
  const urls = getExportUrls(hoursBack);
  console.log(`   Downloading ${urls.length} export files...`);

  let allEvents = [];
  let fetchErrors = 0;
  for (let i = 0; i < urls.length; i += 8) {
    const batch = urls.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(u => fetchSingleFile(u)));
    for (const r of results) {
      if (r.status === 'fulfilled') allEvents.push(...r.value);
      else fetchErrors++;
    }
  }
  if (fetchErrors > 0) console.warn(`   ${fetchErrors} GDELT file downloads failed`);
  console.log(`   Total US events: ${allEvents.length}`);

  // Dedup
  const byId = new Map();
  for (const e of allEvents) byId.set(e.id, e);
  const seen = new Set();
  const deduped = [...byId.values()].filter(e => {
    const key = `${e.rootCode}-${e.lat.toFixed(2)}-${e.lon.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`   After dedup: ${deduped.length} unique events`);

  // Normalize to event objects
  const normalized = [];
  for (const event of deduped) {
    const info = ROOT_CODES[event.rootCode];
    const label = EVENT_LABELS[event.eventCode] || info.label;

    let category;
    if (ARMED_CODES.has(event.eventCode)) category = 'Armed Violence';
    else if (FORCE_CODES.has(event.eventCode)) category = 'Use of Force';
    else category = info.label;
    const color = colorOf(category);

    normalized.push({
      id: event.id,
      event: text(label),
      category,
      severity: event.rootCode === '20' ? 'Extreme' : event.rootCode === '19' ? 'Severe' : 'Moderate',
      headline: text(`${label} — ${event.geo}`),
      description: '',
      areaDesc: text(event.geo),
      color,
      lat: event.lat,
      lon: event.lon,
      sourceUrl: sanitizeUrl(event.sourceUrl),
      timestamp: event.fileTimestamp
    });
  }

  await storeEvents(SOURCE_NAME, normalized, TTL.GDELT);

  // Precise US border backstop (same as FIRMS): drop stored rows that didn't
  // reverse-geocode to a US state — blank-country events the coarse bbox let
  // through (e.g. southern Canada).
  let pruned = 0;
  try { pruned = await deleteWhereNoUSState(SOURCE_NAME); }
  catch (e) { console.warn(`   [gdelt] US-state prune failed: ${e.message}`); }

  console.log(`   ✓ Stored ${normalized.length} GDELT events (${pruned} foreign-pruned)`);
  await setLastUpdate(SOURCE_NAME, Math.max(0, normalized.length - pruned));
  return { total: allEvents.length, stored: normalized.length, pruned };
}

module.exports = { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX, parseCsv, getExportUrls };
