/**
 * USGS Earthquake Data
 * Source: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 * Format: GeoJSON (native)
 * Auth: None
 * Rate: Feed cached 60s server-side. We poll every 5 min.
 */

const { http } = require('../http');
const { text, sanitizeUrl, isInUS, TTL, storeEvents, setLastUpdate } = require('./common');

const SOURCE_NAME = 'USGS';
const CRON_SCHEDULE = '*/5 * * * *'; // every 5 minutes
const PREFIX = 'quake';
const URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

function severity(mag) {
  if (mag >= 6)   return { level: 'Extreme', color: '#3E2723' };
  if (mag >= 4.5) return { level: 'Severe', color: '#4E342E' };
  if (mag >= 3)   return { level: 'Moderate', color: '#6D4C41' };
  if (mag >= 1.5) return { level: 'Minor', color: '#8D6E63' };
  return { level: 'Micro', color: '#A1887F' };
}

async function fetch() {
  console.log('\n🌍 Fetching earthquakes from USGS...');
  let response;
  try {
    response = await http.get(URL);
  } catch (e) {
    console.error(`   USGS API error: ${e.message}`);
    throw e;
  }

  const features = response.data.features || [];
  console.log(`   Total earthquakes (24h): ${features.length}`);

  const usQuakes = features.filter(f => {
    const [lon, lat] = f.geometry.coordinates;
    return isInUS(lat, lon);
  });
  console.log(`   US earthquakes: ${usQuakes.length}`);

  const events = [];
  for (const f of usQuakes) {
    const props = f.properties;
    const [lon, lat, depth] = f.geometry.coordinates;
    const mag = props.mag || 0;
    const sev = severity(mag);
    const id = f.id || `quake-${lat.toFixed(4)}-${lon.toFixed(4)}-${props.time}`;

    events.push({
      id,
      event: 'Earthquake',
      category: 'Earthquake',
      severity: sev.level,
      headline: text(`M${mag.toFixed(1)} — ${props.place || 'Unknown location'}`),
      description: text(`Depth: ${(depth || 0).toFixed(1)} km | Time: ${new Date(props.time).toISOString()}`),
      areaDesc: text(props.place || ''),
      color: sev.color,
      lat,
      lon,
      sourceUrl: sanitizeUrl(props.url),
      timestamp: props.time || Date.now(),
      mag: mag.toFixed(1),
      depth: (depth || 0).toFixed(1)
    });
  }

  await storeEvents(SOURCE_NAME, events, TTL.EARTHQUAKE);
  console.log(`   ✓ Stored ${events.length} earthquakes`);
  await setLastUpdate(SOURCE_NAME, events.length);
  return { total: features.length, stored: events.length };
}

module.exports = { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
