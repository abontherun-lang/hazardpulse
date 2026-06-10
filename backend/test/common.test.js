const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, sanitizeUrl, isInUS, haversineKm, buildGeoJSON } = require('../sources/common');

test('sanitize escapes HTML special characters', () => {
  assert.equal(sanitize(`<script>alert("x&y")</script>`),
    '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;');
  assert.equal(sanitize(`O'Brien`), 'O&#x27;Brien');
});

test('sanitize handles empty and non-string input', () => {
  assert.equal(sanitize(''), '');
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(undefined), '');
  assert.equal(sanitize(42), '42');
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
