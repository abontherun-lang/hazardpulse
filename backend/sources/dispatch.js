/**
 * 911 Dispatch — Aggregated municipal CAD/dispatch feeds.
 *
 * This is a single source module that fetches from multiple city feeds
 * using platform-specific adapters (Socrata, ArcGIS, CSV, etc.).
 *
 * To add a new city: add an entry to dispatch-feeds.json.
 * To add a new platform: create an adapter in adapters/ and register it below.
 */

const { sanitize, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

// Platform adapters — add new ones here
const adapters = {
  socrata: require('./adapters/socrata'),
  arcgis: require('./adapters/arcgis'),
};

const feeds = require('./dispatch-feeds.json');

const SOURCE_NAME = '911 Dispatch';
const CRON_SCHEDULE = '*/10 * * * *'; // every 10 minutes
const PREFIX = 'dispatch';

// Severity mapping for dispatch categories
const CATEGORY_SEVERITY = {
  'Dispatch Violence': 'Extreme',
  'Dispatch Fire': 'Severe',
  'Dispatch Hazmat': 'Severe',
  'Dispatch Accident': 'Moderate',
  'Dispatch Other': 'Moderate',
};

const CATEGORY_COLORS = {
  'Dispatch Violence': '#D500F9',
  'Dispatch Fire': '#FF6D00',
  'Dispatch Hazmat': '#00E676',
  'Dispatch Accident': '#FFAB00',
  'Dispatch Other': '#546E7A',
};

async function fetch() {
  let totalStored = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    const adapter = adapters[feed.platform];
    if (!adapter) {
      console.error(`   Dispatch: unknown platform "${feed.platform}" for ${feed.city}`);
      continue;
    }

    try {
      const incidents = await adapter.fetchIncidents(feed);

      const events = incidents.map(inc => {
        const category = inc.category || 'Dispatch Other';
        return {
          id: inc.id,
          event: sanitize(inc.type),
          category,
          severity: CATEGORY_SEVERITY[category] || 'Moderate',
          headline: sanitize(`${inc.type} — ${inc.city}`),
          description: '',
          areaDesc: sanitize(inc.address || inc.city),
          color: CATEGORY_COLORS[category] || '#546E7A',
          sourceUrl: feed.sourceUrl || (feed.domain ? `https://${feed.domain}/d/${feed.dataset}` : ''),
          timestamp: inc.time,
          lat: inc.lat,
          lon: inc.lon,
          city: sanitize(inc.city),
          dispatchType: sanitize(inc.type)
        };
      });

      await storeEvents(SOURCE_NAME, events, TTL.DISPATCH);
      totalStored += events.length;
      console.log(`   ${feed.city}: ${events.length} incidents`);
    } catch (e) {
      console.error(`   ${feed.city} failed: ${e.message}${e.response ? ' — ' + JSON.stringify(e.response.data).substring(0, 200) : ''}`);
      totalErrors++;
    }
  }

  await setLastUpdate(SOURCE_NAME, totalStored);
  return { stored: totalStored, errors: totalErrors };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
