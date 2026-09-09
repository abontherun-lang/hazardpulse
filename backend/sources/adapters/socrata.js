/**
 * Socrata SODA API adapter for dispatch feeds.
 *
 * Fetches incidents from a Socrata open data portal, applies server-side
 * filtering via $where clause, and normalizes to the standard dispatch
 * incident format.
 *
 * Each feed config declares its field mappings, crisis type filters, and
 * optional priority filter. This adapter translates those into Socrata
 * query syntax so we only download crisis-level incidents.
 */

const { http } = require('../../http');

/**
 * Fetch incidents from a Socrata feed.
 * @param {object} feed — config entry from dispatch-feeds.json
 * @returns {Array<{id, type, category, lat, lon, time, address, city}>}
 */
/**
 * The SoQL $where for a feed. Pure; `now` is injectable for tests.
 * Socrata floating_timestamps may be local time (not UTC), so the window
 * is padded to 24h and row expiry handles the rest. Over-fetches slightly
 * but avoids timezone mismatch issues.
 */
function buildWhere(feed, now = Date.now()) {
  const { fields, crisisTypes, priorityFilter } = feed;
  const whereParts = [];

  if (fields.time) {
    const since = new Date(now - 24 * 3600000).toISOString().replace('Z', '');
    whereParts.push(`${fields.time} > '${since}'`);
  }

  if (priorityFilter) {
    const vals = priorityFilter.values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
    whereParts.push(`${priorityFilter.field} IN (${vals})`);
  }

  if (crisisTypes && crisisTypes.length > 0) {
    const escaped = crisisTypes.map(t => `'${t.replace(/'/g, "''")}'`).join(',');
    whereParts.push(`${fields.type} IN (${escaped})`);
  }

  if (fields.lat && fields.lon) {
    whereParts.push(`${fields.lat} IS NOT NULL`);
  } else if (fields.geoPoint) {
    whereParts.push(`${fields.geoPoint} IS NOT NULL`);
  }

  return whereParts.join(' AND ');
}

async function fetchIncidents(feed) {
  const { domain, dataset, fields } = feed;
  const where = buildWhere(feed);
  const url = `https://${domain}/resource/${dataset}.json`;

  const params = {
    '$limit': 500,
    '$order': `${fields.time} DESC`,
  };
  if (where) params['$where'] = where;

  const response = await http.get(url, {
    params,
    timeout: 15000,
    headers: { 'Accept': 'application/json' }
  });

  if (!Array.isArray(response.data)) return [];

  // Normalize each record
  return response.data
    .map(row => normalize(row, feed))
    .filter(Boolean);
}

/**
 * Normalize a Socrata row to our standard incident format.
 */
function normalize(row, feed) {
  const { fields, categoryMap, city, state } = feed;

  // Extract coordinates
  let lat, lon;
  if (fields.geoPoint) {
    // GeoJSON point field (e.g. SF intersection_point)
    const pt = row[fields.geoPoint];
    if (!pt || !pt.coordinates) return null;
    lon = pt.coordinates[0];
    lat = pt.coordinates[1];
  } else {
    lat = parseFloat(row[fields.lat]);
    lon = parseFloat(row[fields.lon]);
  }
  if (isNaN(lat) || isNaN(lon)) return null;

  // Extract type and map to category
  const rawType = row[fields.type] || 'Unknown';
  const category = (categoryMap && categoryMap[rawType]) || 'Dispatch Other';

  // Extract time
  const time = row[fields.time] ? new Date(row[fields.time]).getTime() : Date.now();

  // Extract ID
  const id = row[fields.id] || `${feed.id}_${time}_${lat}_${lon}`;

  return {
    id: String(id),
    type: rawType,
    category,
    lat,
    lon,
    time,
    address: row[fields.address] || '',
    city: `${city}, ${state}`,
  };
}

module.exports = { fetchIncidents, normalize, buildWhere };
