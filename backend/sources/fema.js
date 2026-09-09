/**
 * FEMA IPAWS Archived Alerts
 * Source: https://www.fema.gov/api/open/v1/IpawsArchivedAlerts
 * Format: JSON with embedded CAP XML
 * Auth: None
 * Rate: Archive feed, ~24h lag. We poll every 15 min.
 *
 * Routes alerts to existing map layers:
 * - Missing persons/AMBER/Silver → "Missing Persons"
 * - Fire-related → "Wildfire"
 * - Everything else (law enforcement, evacuation, emergency) → "Official Alerts"
 * Skips: tests, demos, weather duplicates (NOAA covers those)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { text, sanitizeUrl, isInUS, TTL, storeEvent, getActiveEvents, setLastUpdate } = require('./common');

// Load UGC centroids for SAME/FIPS code geocoding fallback
let ugcCentroids = {};
try {
  ugcCentroids = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ugc_centroids.json'), 'utf-8'));
} catch (_) {}

// FIPS state codes to state abbreviations
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

// State centroids for statewide alerts (county=000)
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

// Convert SAME/FIPS code (0SSCCC) to lat/lon via UGC centroid or state centroid
function geocodeSameCode(sameCode) {
  if (!sameCode || sameCode.length !== 6) return null;
  const stateFips = sameCode.slice(1, 3);
  const countyFips = sameCode.slice(3);
  const state = FIPS_TO_STATE[stateFips];
  if (!state) return null;

  // Try county-level lookup first
  if (countyFips !== '000') {
    const ugc = `${state}C${countyFips}`;
    const coords = ugcCentroids[ugc];
    if (coords) return { type: 'Point', coordinates: [coords[1], coords[0]] };
  }

  // Fall back to state centroid (for statewide alerts or unknown counties)
  const stateCoords = STATE_CENTROIDS[state];
  if (stateCoords) return { type: 'Point', coordinates: [stateCoords[1], stateCoords[0]] };

  return null;
}

const SOURCE_NAME = 'FEMA IPAWS';
const CRON_SCHEDULE = '*/15 * * * *';
const PREFIX = 'fema';
const URL = 'https://www.fema.gov/api/open/v1/IpawsArchivedAlerts';

// Word-boundary patterns to skip test/demo messages
// Uses regex to avoid "protest" matching "test", "demonstrate" matching "demo"
const SKIP_REGEXES = [
  /\btest\b/i,
  /\bdemo\b/i,
  /\broutine\b/i,
  /\bmccd\b/i
];
const SKIP_WEATHER = new Set([
  'Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning',
  'Flood Warning', 'Flood Watch', 'Winter Storm Warning'
]);

function classify(event, headline) {
  const combined = (event + ' ' + (headline || '')).toLowerCase();
  if (SKIP_WEATHER.has(event)) return null;
  if (SKIP_REGEXES.some(rx => rx.test(combined))) return null;

  if (combined.includes('missing') || combined.includes('endangered') ||
      combined.includes('child abduction') || combined.includes('amber alert') ||
      combined.includes('silver alert') || combined.includes('safe alert'))
    return { category: 'Missing Persons', color: '#FF6F00' };

  if (event.toLowerCase().includes('fire') || event.toLowerCase().includes('red flag'))
    return { category: 'Wildfire', color: '#E65100' };

  if (event.toLowerCase().includes('administrative')) return null;

  return { category: 'Official Alerts', color: '#D50000' };
}

// CAP text is XML-escaped ("Sheriff&apos;s Office", "A&amp;W"); decode it here so
// the stored text is plain and the frontend escapes it exactly once.
function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function parsePolygon(str) {
  const coords = str.trim().split(/\s+/).map(pair => {
    const [lat, lon] = pair.split(',').map(Number);
    return [lon, lat];
  });
  if (coords.length < 3) return null;
  if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])
    coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

function parseCircle(str) {
  const [coords] = str.trim().split(/\s+/);
  const [lat, lon] = coords.split(',').map(Number);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { type: 'Point', coordinates: [lon, lat] };
}

async function fetch() {
  console.log('\n🏛️  Fetching FEMA IPAWS alerts...');
  let response;
  try {
    response = await axios.get(URL, {
      params: { '$top': 200, '$orderby': 'sent desc' },
      timeout: 20000
    });
  } catch (e) {
    console.error(`   FEMA API error: ${e.message}`);
    throw e;
  }

  const alerts = response.data.IpawsArchivedAlerts || [];
  console.log(`   Received ${alerts.length} IPAWS alerts`);

  let stored = 0, skipped = 0;
  for (const alert of alerts) {
    const xml = alert.originalMessage || '';
    const extract = (tag) => { const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? decodeXml(m[1]) : ''; };

    const event = extract('event');
    const headline = extract('headline');
    const cls = classify(event, headline);
    if (!cls) { skipped++; continue; }

    const sent = extract('sent');
    if (sent && new Date(sent).getTime() < Date.now() - 48 * 60 * 60 * 1000) { skipped++; continue; }

    const polygonMatch = xml.match(/<polygon>([^<]+)<\/polygon>/);
    const circleMatch = xml.match(/<circle>([^<]+)<\/circle>/);
    let geometry = polygonMatch ? parsePolygon(polygonMatch[1]) : circleMatch ? parseCircle(circleMatch[1]) : null;

    // Fallback: geocode from SAME/FIPS codes in the alert
    if (!geometry) {
      const sameCodes = xml.match(/<geocode>\s*<valueName>SAME<\/valueName>\s*<value>(\d+)<\/value>\s*<\/geocode>/g) || [];
      for (const match of sameCodes) {
        const code = match.match(/<value>(\d+)<\/value>/);
        if (code) {
          geometry = geocodeSameCode(code[1]);
          if (geometry) break;
        }
      }
    }
    if (!geometry) { skipped++; continue; }

    let lat, lon;
    if (geometry.type === 'Point') { [lon, lat] = geometry.coordinates; }
    else { const c = geometry.coordinates[0]; lat = c.reduce((s,p) => s+p[1], 0)/c.length; lon = c.reduce((s,p) => s+p[0], 0)/c.length; }
    if (!isInUS(lat, lon)) { skipped++; continue; }

    // Dedup by sender + event + area (not timestamp) so repeat alerts for the same incident collapse
    const areaKey = (extract('areaDesc') || '').slice(0, 30).replace(/[^a-zA-Z0-9]/g, '');
    const senderKey = (extract('senderName') || '').slice(0, 20).replace(/[^a-zA-Z0-9]/g, '');
    const id = `fema-${senderKey}-${event.slice(0,20).replace(/[^a-zA-Z]/g, '')}-${areaKey}`;

    await storeEvent(SOURCE_NAME, id, {
      event: cls.category,
      category: cls.category,
      severity: text(extract('severity')) || 'Severe',
      headline: text(headline || event),
      description: text((extract('description') || '').slice(0, 500)),
      areaDesc: text(extract('areaDesc') || extract('senderName')),
      color: cls.color,
      sourceUrl: sanitizeUrl(extract('web')),
      timestamp: new Date(sent).getTime() || Date.now(),
      geometry,
      // Source-specific extras → props JSONB
      urgency: text(extract('urgency')),
      femaEvent: text(event),
      instruction: text((extract('instruction') || '').slice(0, 500)),
      senderName: text(extract('senderName'))
    }, TTL.FEMA);
    stored++;
  }

  console.log(`   ✓ Stored ${stored} FEMA alerts (skipped ${skipped})`);
  await setLastUpdate(SOURCE_NAME, stored);
  return { total: alerts.length, stored, skipped };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX, classify, parsePolygon, parseCircle, decodeXml };
