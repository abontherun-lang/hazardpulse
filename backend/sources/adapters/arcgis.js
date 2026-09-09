/**
 * ArcGIS FeatureServer adapter for dispatch feeds.
 *
 * Fetches incidents from an ArcGIS REST endpoint, applies server-side
 * filtering via the `where` clause, and normalizes to the standard
 * dispatch incident format.
 */

const { http } = require('../../http');

/**
 * Fetch incidents from an ArcGIS FeatureServer layer.
 * @param {object} feed — config entry from dispatch-feeds.json
 * @returns {Array<{id, type, category, lat, lon, time, address, city}>}
 */
/**
 * The ArcGIS where clause for a feed. Pure; `now` is injectable for tests.
 * ArcGIS date comparisons need the TIMESTAMP keyword.
 */
function buildWhere(feed, now = Date.now()) {
  const { fields, crisisTypes, hoursBack } = feed;
  const whereParts = [];

  if (fields.time) {
    const since = new Date(now - (hoursBack || 24) * 3600000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    whereParts.push(`${fields.time} > TIMESTAMP '${since}'`);
  }

  if (crisisTypes && crisisTypes.length > 0) {
    const escaped = crisisTypes.map(t => `'${t.replace(/'/g, "''")}'`).join(',');
    whereParts.push(`${fields.type} IN (${escaped})`);
  }

  if (fields.lat && fields.lon) {
    whereParts.push(`${fields.lat} IS NOT NULL`);
  }

  return whereParts.length > 0 ? whereParts.join(' AND ') : '1=1';
}

async function fetchIncidents(feed) {
  const { endpoint, fields } = feed;
  const where = buildWhere(feed);

  // Build the query string by hand — the client's params serializer and
  // URLSearchParams both encode spaces as '+', which ArcGIS rejects
  const outFields = Object.values(fields).filter(Boolean).join(',');
  const qs = `where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&orderByFields=${encodeURIComponent(fields.time + ' DESC')}&resultRecordCount=500&f=json`;

  const response = await http.get(`${endpoint}?${qs}`, {
    timeout: 15000
  });

  const features = response.data && response.data.features;
  if (!Array.isArray(features)) return [];

  return features
    .map(f => normalize(f.attributes, feed))
    .filter(Boolean);
}

/**
 * Normalize an ArcGIS feature to our standard incident format.
 */
function normalize(attrs, feed) {
  const { fields, categoryMap, city, state } = feed;

  const lat = parseFloat(attrs[fields.lat]);
  const lon = parseFloat(attrs[fields.lon]);
  if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return null;

  const rawType = attrs[fields.type] || 'Unknown';
  const category = (categoryMap && categoryMap[rawType]) || 'Dispatch Other';

  // ArcGIS timestamps are epoch milliseconds
  const time = attrs[fields.time] || Date.now();

  const id = attrs[fields.id] || `${feed.id}_${time}_${lat}_${lon}`;

  return {
    id: String(id),
    type: rawType,
    category,
    lat,
    lon,
    time,
    address: attrs[fields.address] || '',
    city: `${city}, ${state}`,
  };
}

module.exports = { fetchIncidents, normalize, buildWhere };
