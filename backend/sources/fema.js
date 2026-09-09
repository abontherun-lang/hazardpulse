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
 * Skips: tests, demos, and anything sent by the NWS — those are the same
 * alerts the NOAA feed already carries (see alert-policy.js), on a slower
 * archive. Local authorities (county EMAs, police, state DPS) are what
 * IPAWS adds.
 */

const axios = require('axios');
const { text, sanitizeUrl, isInUS, TTL, storeEvent, getActiveEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');
const { sameCodesToPoint } = require('./geo');

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
// CAP <sender> of NWS-issued IPAWS messages (w-nws.webmaster@noaa.gov).
const NWS_SENDER_RE = /nws|noaa\.gov/i;

function classify(event, headline, sender = '') {
  const combined = (event + ' ' + (headline || '')).toLowerCase();
  if (NWS_SENDER_RE.test(sender)) return null;
  if (SKIP_REGEXES.some(rx => rx.test(combined))) return null;

  if (combined.includes('missing') || combined.includes('endangered') ||
      combined.includes('child abduction') || combined.includes('amber alert') ||
      combined.includes('silver alert') || combined.includes('safe alert'))
    return { category: 'Missing Persons' };

  if (event.toLowerCase().includes('fire') || event.toLowerCase().includes('red flag'))
    return { category: 'Wildfire' };

  if (event.toLowerCase().includes('administrative')) return null;

  return { category: 'Official Alerts' };
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
    const cls = classify(event, headline, extract('sender'));
    if (!cls) { skipped++; continue; }

    const sent = extract('sent');
    if (sent && new Date(sent).getTime() < Date.now() - 48 * 60 * 60 * 1000) { skipped++; continue; }

    const polygonMatch = xml.match(/<polygon>([^<]+)<\/polygon>/);
    const circleMatch = xml.match(/<circle>([^<]+)<\/circle>/);
    let geometry = polygonMatch ? parsePolygon(polygonMatch[1]) : circleMatch ? parseCircle(circleMatch[1]) : null;

    // Fallback: geocode from SAME/FIPS codes in the alert
    if (!geometry) {
      const sameCodes = [...xml.matchAll(/<geocode>\s*<valueName>SAME<\/valueName>\s*<value>(\d+)<\/value>\s*<\/geocode>/g)].map(m => m[1]);
      geometry = sameCodesToPoint(sameCodes);
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
      color: colorOf(cls.category),
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
