const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport } = require('../sources/spc');

const attrs = { OBJECTID: 7, UTC_DATETIME: 1788384300000, F_SCALE: null, LOCATION: '3 ENE Serenada', COUNTY: 'Williamson', STATE: 'TX', COMMENTS: 'Landspout (EWX)' };

test('a report is keyed by time and location, not OBJECTID', () => {
  const a = normalizeReport(attrs, { x: -97.65, y: 30.72 });
  const b = normalizeReport({ ...attrs, OBJECTID: 99 }, { x: -97.65, y: 30.72 });
  assert.equal(a.id, b.id);
  assert.equal(a.id, 'spc-tornado-1788384300000-30.72--97.65');
});

test('reports are preliminary and unrated unless F_SCALE is set', () => {
  const r = normalizeReport(attrs, { x: -97.65, y: 30.72 });
  assert.equal(r.category, 'Tornado Report');
  assert.equal(r.preliminary, true);
  assert.equal(r.rating, undefined);
  assert.equal(r.headline, 'Tornado reported — 3 ENE Serenada, Williamson, TX');
  assert.equal(normalizeReport({ ...attrs, F_SCALE: 'EF2' }, { x: -97.65, y: 30.72 }).rating, 'EF2');
});

test('reports without a position or outside the US are dropped', () => {
  assert.equal(normalizeReport(attrs, null), null);
  assert.equal(normalizeReport(attrs, { x: null, y: 30 }), null);
  assert.equal(normalizeReport(attrs, { x: -99.13, y: 19.43 }), null); // Mexico City
});
