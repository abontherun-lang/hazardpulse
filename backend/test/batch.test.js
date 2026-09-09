const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBatchRows } = require('../sources/common');

const NOW = 1789000000000;
const evt = (id, extra = {}) => ({ id, event: 'Earthquake', category: 'Earthquake', severity: 'Minor', headline: `M2 — ${id}`, lat: 39.5, lon: -86.2, timestamp: NOW - 60000, mag: '2.0', ...extra });

test('builds parallel column arrays with props from the extras', () => {
  const { columns, count, skipped } = buildBatchRows('USGS', [evt('q1'), evt('q2', { depth: '5.0', empty: '', nothing: null })], 3600, NOW);
  assert.equal(count, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(columns.id, ['q1', 'q2']);
  assert.deepEqual(columns.source, ['USGS', 'USGS']);
  assert.equal(columns.event_time[0], new Date(NOW - 60000).toISOString());
  assert.equal(columns.expires_at[0], new Date(NOW + 3600000).toISOString());
  assert.deepEqual(JSON.parse(columns.geojson[0]), { type: 'Point', coordinates: [-86.2, 39.5] });
  assert.deepEqual(JSON.parse(columns.props[1]), { mag: '2.0', depth: '5.0' }); // known fields, empty and null excluded
  for (const key of Object.keys(columns)) assert.equal(columns[key].length, 2, key);
});

test('a duplicate id in one batch keeps the last row (ON CONFLICT cannot hit a row twice)', () => {
  const { columns, count } = buildBatchRows('SPC', [evt('a', { headline: 'first' }), evt('a', { headline: 'second' })], 60, NOW);
  assert.equal(count, 1);
  assert.deepEqual(columns.headline, ['second']);
});

test('rows without usable geometry or an id are skipped and counted', () => {
  const { count, skipped } = buildBatchRows('X', [evt('ok'), { id: 'nogeo', event: 'x' }, { ...evt('noid'), id: null }, evt('bad', { lat: 'abc' })], 60, NOW);
  assert.equal(count, 1);
  assert.equal(skipped, 3);
});

test('explicit geometry passes through and a bad timestamp falls back to now', () => {
  const line = { type: 'LineString', coordinates: [[-90.4, 30.5], [-90.3, 30.6]] };
  const { columns } = buildBatchRows('NWS DAT', [{ id: 't', geometry: line, timestamp: 'garbage' }], 60, NOW);
  assert.deepEqual(JSON.parse(columns.geojson[0]), line);
  assert.equal(columns.event_time[0], new Date(NOW).toISOString());
  assert.equal(columns.severity[0], 'Unknown');
});
