/**
 * 911 Dispatch — Aggregated municipal CAD/dispatch feeds.
 *
 * This is a single source module that fetches from multiple city feeds
 * using platform-specific adapters (Socrata, ArcGIS, CSV, etc.).
 *
 * To add a new city: add an entry to dispatch-feeds.json.
 * To add a new platform: create an adapter in adapters/ and register it below.
 */

const { text, TTL, storeEvents, getActiveEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');

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

// Consecutive zero-row cycles per feed. A city feed that silently changes
// its schema (Cincinnati, 2026-09) returns HTTP 200 and no rows forever;
// this is the only signal that it happened.
const ZERO_WARN_AFTER = 3;
const zeroStreak = new Map();

async function fetch() {
  let totalStored = 0;
  let totalErrors = 0;
  const perFeed = {};

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
          event: text(inc.type),
          category,
          severity: CATEGORY_SEVERITY[category] || 'Moderate',
          headline: text(`${inc.type} — ${inc.city}`),
          description: '',
          areaDesc: text(inc.address || inc.city),
          color: colorOf(category, '#546E7A'),
          sourceUrl: feed.sourceUrl || (feed.domain ? `https://${feed.domain}/d/${feed.dataset}` : ''),
          timestamp: inc.time,
          lat: inc.lat,
          lon: inc.lon,
          city: text(inc.city),
          dispatchType: text(inc.type)
        };
      });

      await storeEvents(SOURCE_NAME, events, TTL.DISPATCH);
      totalStored += events.length;
      perFeed[feed.id] = events.length;
      console.log(`   ${feed.city}: ${events.length} incidents`);

      if (events.length === 0) {
        const streak = (zeroStreak.get(feed.id) || 0) + 1;
        zeroStreak.set(feed.id, streak);
        if (streak >= ZERO_WARN_AFTER) {
          console.warn(`   ⚠ ${feed.city}: 0 incidents for ${streak} consecutive cycles — the feed may have changed (${feed.domain || feed.endpoint})`);
        }
      } else {
        zeroStreak.set(feed.id, 0);
      }
    } catch (e) {
      console.error(`   ${feed.city} failed: ${e.message}${e.response ? ' — ' + JSON.stringify(e.response.data).substring(0, 200) : ''}`);
      perFeed[feed.id] = { error: e.message };
      totalErrors++;
    }
  }

  await setLastUpdate(SOURCE_NAME, totalStored);
  return { stored: totalStored, errors: totalErrors, feeds: perFeed };
}

async function getActive() {
  return getActiveEvents(SOURCE_NAME);
}

module.exports = { fetch, getActive, SOURCE_NAME, CRON_SCHEDULE, PREFIX };
