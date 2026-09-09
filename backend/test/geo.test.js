const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FIPS_TO_STATE, STATE_FIPS, STATE_CENTROIDS, sameCodeToPoint, sameCodesToPoint } = require('../sources/geo');

// SAME code format: 0SSCCC — leading 0, 2-digit state FIPS, 3-digit county FIPS

test('state tables agree with each other', () => {
  assert.equal(Object.keys(FIPS_TO_STATE).length, 51);
  for (const [fips, st] of Object.entries(FIPS_TO_STATE)) {
    assert.equal(STATE_FIPS[st], fips);
    assert.ok(STATE_CENTROIDS[st], `${st} centroid`);
  }
  assert.equal(STATE_FIPS.IN, '18');
});

test('resolves a county-level SAME code via UGC centroids', () => {
  // 018097 = Marion County, IN (UGC INC097, bundled in ugc_centroids.json)
  const geom = sameCodeToPoint('018097');
  assert.equal(geom.type, 'Point');
  const [lon, lat] = geom.coordinates;
  assert.ok(Math.abs(lat - 39.78) < 0.1, `lat ${lat}`);
  assert.ok(Math.abs(lon - -86.14) < 0.1, `lon ${lon}`);
});

test('statewide SAME code (county 000) falls back to the state centroid', () => {
  assert.deepEqual(sameCodeToPoint('018000'), { type: 'Point', coordinates: [-86.1, 40.3] });
});

test('sameCodesToPoint uses the first resolvable code', () => {
  assert.deepEqual(sameCodesToPoint(['xxxxxx', '018000']), { type: 'Point', coordinates: [-86.1, 40.3] });
});

test('returns null for unresolvable input', () => {
  assert.equal(sameCodesToPoint([]), null);
  assert.equal(sameCodesToPoint(null), null);
  assert.equal(sameCodeToPoint('12345'), null);   // wrong length
  assert.equal(sameCodeToPoint('099000'), null);  // unknown state FIPS
  assert.equal(sameCodeToPoint(null), null);
});
