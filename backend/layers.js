/**
 * The layer registry — the one place a map type gets its group, color,
 * legend row, cluster and preset membership. layers.json is the data; this
 * module serves it to the backend (colors for stored events) and, through
 * GET /api/layers, to the frontend (groups, legend, presets, status list).
 *
 * "Type" is the value in an event's `category` column: the legend row it
 * toggles and the status-count bucket it lands in.
 */

const registry = require('./layers.json');
const dispatchFeeds = require('./sources/dispatch-feeds.json');

const TYPES = registry.types;

// The dispatch group's hint lists the live feeds, so it cannot go stale.
const dispatchGroup = registry.groups.find(g => g.key === 'dispatch');
if (dispatchGroup) {
  dispatchGroup.hint = `City 911/CAD — ${dispatchFeeds.map(f => f.city).join(', ')}`;
}

/** Color for a registered type; the fallback for anything unregistered. */
function colorOf(type, fallback = '#808080') {
  return (TYPES[type] && TYPES[type].color) || fallback;
}

function has(type) {
  return Object.prototype.hasOwnProperty.call(TYPES, type);
}

/** Every type that has a legend row, in legend order. */
function legendTypes() {
  return registry.groups.flatMap(g => g.rows.flatMap(r => r.types));
}

module.exports = { registry, TYPES, colorOf, has, legendTypes };
