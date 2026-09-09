const { test } = require('node:test');
const assert = require('node:assert/strict');
const { text, sanitizeUrl, isInUS, haversineKm, buildGeoJSON, cronIntervalMinutes } = require('../sources/common');

test('text stores upstream strings raw — escaping happens once, in the frontend', () => {
  assert.equal(text(`Fisher's Mesa & A&W <fire>`), `Fisher's Mesa & A&W <fire>`);
});

test('text strips control characters and trims', () => {
  assert.equal(text('  Tornado\u0000 Warning\u001f  '), 'Tornado Warning');
  assert.equal(text('line one\nline two'), 'line one\nline two'); // newlines survive
});

test('text handles empty and non-string input', () => {
  assert.equal(text(''), '');
  assert.equal(text(null), '');
  assert.equal(text(undefined), '');
  assert.equal(text(42), '42');
});

test('cronIntervalMinutes reads the cron shapes the sources use', () => {
  assert.equal(cronIntervalMinutes('*/15 * * * *'), 15);
  assert.equal(cronIntervalMinutes('*/5 * * * *'), 5);
  assert.equal(cronIntervalMinutes('0 * * * *'), 60);
  assert.equal(cronIntervalMinutes('15 * * * *'), 60);
  assert.equal(cronIntervalMinutes('0 */3 * * *'), 180);
  assert.equal(cronIntervalMinutes('weird'), null);
  assert.equal(cronIntervalMinutes(undefined), null);
});

test('sanitizeUrl allows only http(s) URLs', () => {
  assert.equal(sanitizeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(sanitizeUrl('http://example.com'), 'http://example.com');
  assert.equal(sanitizeUrl('  https://example.com  '), 'https://example.com');
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('ftp://example.com'), '');
  assert.equal(sanitizeUrl(''), '');
  assert.equal(sanitizeUrl(null), '');
});

test('isInUS accepts points in US regions', () => {
  assert.equal(isInUS(39.77, -86.16), true);   // Indianapolis
  assert.equal(isInUS(61.2, -149.9), true);    // Anchorage
  assert.equal(isInUS(21.3, -157.9), true);    // Honolulu
  assert.equal(isInUS(18.4, -66.1), true);     // San Juan, PR
  assert.equal(isInUS(13.47, 144.75), true);   // Guam
});

test('isInUS rejects points outside all bounding boxes', () => {
  // The boxes are deliberately coarse (southern Canada / northern Mexico leak
  // through) — the precise filter is the TIGER state join downstream. These
  // points are outside even the coarse boxes.
  assert.equal(isInUS(19.43, -99.13), false);  // Mexico City
  assert.equal(isInUS(51.5, -0.12), false);    // London
  assert.equal(isInUS(56.1, -106.3), false);   // central Canada
});

test('haversineKm computes great-circle distance', () => {
  // Indianapolis → Chicago is ~265 km
  const d = haversineKm(39.768, -86.158, 41.878, -87.63);
  assert.ok(d > 255 && d < 275, `expected ~265, got ${d}`);
  assert.equal(haversineKm(39.7, -86.1, 39.7, -86.1), 0);
});

test('buildGeoJSON builds a Point from lat/lon', () => {
  assert.deepEqual(JSON.parse(buildGeoJSON({ lat: 39.5, lon: -86.2 })),
    { type: 'Point', coordinates: [-86.2, 39.5] });
});

test('buildGeoJSON passes explicit geometry through', () => {
  const geom = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  assert.deepEqual(JSON.parse(buildGeoJSON({ geometry: geom })), geom);
});

test('buildGeoJSON rejects missing or out-of-range coordinates', () => {
  assert.equal(buildGeoJSON({}), null);
  assert.equal(buildGeoJSON({ lat: 'abc', lon: -86 }), null);
  assert.equal(buildGeoJSON({ lat: 91, lon: 0 }), null);
  assert.equal(buildGeoJSON({ lat: 0, lon: -181 }), null);
});
