const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveUgcCentroid } = require('../sources/noaa');

// SAME code format: 0SSCCC — leading 0, 2-digit state FIPS, 3-digit county FIPS

test('resolves a county-level SAME code via UGC centroids', () => {
  // 018097 = Marion County, IN (UGC INC097, bundled in ugc_centroids.json)
  const geom = resolveUgcCentroid(['018097']);
  assert.equal(geom.type, 'Point');
  const [lon, lat] = geom.coordinates;
  assert.ok(Math.abs(lat - 39.78) < 0.1, `lat ${lat}`);
  assert.ok(Math.abs(lon - -86.14) < 0.1, `lon ${lon}`);
});

test('statewide SAME code (county 000) falls back to state centroid', () => {
  const geom = resolveUgcCentroid(['018000']); // Indiana statewide
  assert.deepEqual(geom, { type: 'Point', coordinates: [-86.1, 40.3] });
});

test('uses the first resolvable code', () => {
  const geom = resolveUgcCentroid(['xxxxxx', '018000']);
  assert.deepEqual(geom, { type: 'Point', coordinates: [-86.1, 40.3] });
});

test('returns null for unresolvable input', () => {
  assert.equal(resolveUgcCentroid([]), null);
  assert.equal(resolveUgcCentroid(null), null);
  assert.equal(resolveUgcCentroid(['12345']), null);     // wrong length
  assert.equal(resolveUgcCentroid(['099000']), null);    // unknown state FIPS
});
