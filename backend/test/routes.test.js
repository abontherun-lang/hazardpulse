// Route smoke tests against a stubbed pool: no Postgres, no network.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../db');

// Canned answers for the three queries getAllActiveEvents runs, plus health.
let pgDown = false;
const NOW = Date.now();
pool.query = async (sql) => {
  if (pgDown) throw new Error('connection refused');
  if (/SELECT 1/.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
  if (/FROM source_meta/.test(sql)) return { rows: [{ source: 'USGS', last_update: new Date(NOW - 120000), last_count: 1 }], rowCount: 1 };
  if (/GROUP BY source/.test(sql)) return { rows: [{ source: 'USGS', count: '1', time_min: NOW - 3600000, time_max: NOW }], rowCount: 1 };
  if (/FROM events e/.test(sql)) return { rows: [{
    id: 'q1', source: 'USGS', event: 'Earthquake', category: 'Earthquake', severity: 'Minor',
    headline: "M2.1 — Fisher's Mesa & A&W", description: '', area_desc: 'x', color: '#6D4C41', source_url: '',
    timestamp: NOW - 60000, geometry: { type: 'Point', coordinates: [-86.2, 39.5] }, props: { mag: '2.1' },
    state_abbr: 'IN', state_name: 'indiana', county: 'marion', city: 'indianapolis', scanner_ctid: 1234, state_fips: '18'
  }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};

const { app, SOURCES } = require('../server');
let server, base;

before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

test('GET /api/layers serves the registry with a cache header', async () => {
  const res = await fetch(`${base}/api/layers`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  const body = await res.json();
  assert.ok(Array.isArray(body.groups) && body.groups.length >= 8);
  assert.ok(body.types['Tornado Warning']);
});

test('GET /api/all builds the collection from the pool, raw text, scanner link, refresh interval', async () => {
  const res = await fetch(`${base}/api/all`);
  assert.equal(res.status, 200);
  const etag = res.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{40}"$/, 'content-hash ETag');
  const body = await res.json();
  assert.equal(body.type, 'FeatureCollection');
  assert.equal(body.features.length, 1);
  const p = body.features[0].properties;
  assert.equal(p.headline, "M2.1 — Fisher's Mesa & A&W");   // stored raw, escaped only in the browser
  assert.equal(p.scannerUrl, 'https://www.broadcastify.com/listen/ctid/1234');
  assert.equal(p.county, 'Marion');
  assert.equal(body.meta.quake.count, 1);
  assert.equal(body.meta.quake.refreshMinutes, 5);
  assert.ok(body.meta.timeBounds.max >= body.meta.timeBounds.min);
});

test('GET /api/all answers 304 to a matching If-None-Match', async () => {
  const first = await fetch(`${base}/api/all`);
  const etag = first.headers.get('etag');
  const second = await fetch(`${base}/api/all`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
  const third = await fetch(`${base}/api/all`, { headers: { 'If-None-Match': '"stale"' } });
  assert.equal(third.status, 200);
});

test('GET /api/health is 200 while Postgres answers and 503 when it does not', async () => {
  let res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.postgres, 'connected');
  assert.equal(body.status, 'starting');           // no initial fetch has run in this process
  assert.equal(body.sources.length, SOURCES.length);
  assert.equal(body.redis, undefined);

  pgDown = true;
  try {
    res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 503);
    body = await res.json();
    assert.equal(body.status, 'degraded');
  } finally {
    pgDown = false;
  }
});

test('GET /api/location and /api/weather are 404 before a location is resolved', async () => {
  assert.equal((await fetch(`${base}/api/location`)).status, 404);
  assert.equal((await fetch(`${base}/api/weather`)).status, 404);
});

test('the frontend and the vendored libraries are served', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  const lib = await fetch(`${base}/vendor/leaflet/leaflet.js`);
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('cache-control'), /max-age=86400/);
  assert.equal((await fetch(`${base}/scanner_lookup.json`)).status, 404, 'data files are not public');
});
