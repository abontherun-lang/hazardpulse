const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDetections, corrRadiusKm } = require('../sources/firms');

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';

// Build a CSV row matching the FIRMS column layout used by parseDetections:
// cols[0]=lat, cols[1]=lon, cols[5]=acq_date, cols[6]=acq_time,
// cols[8]=confidence, cols[11]=frp, cols[12]=daynight
function row({ lat, lon, frp = 1, confidence = 'nominal', date = '2026-06-10', time = '1230' }) {
  return `${lat},${lon},300,0.4,0.4,${date},${time},N,${confidence},2.0NRT,290,${frp},D`;
}

function csv(...rows) {
  return [HEADER, ...rows].join('\n');
}

test('rejects non-string payloads', () => {
  assert.throws(() => parseDetections(null), /non-CSV/);
  assert.throws(() => parseDetections({ error: 'x' }), /non-CSV/);
});

test('rejects payloads without a FIRMS CSV header (e.g. NASA HTML error pages)', () => {
  assert.throws(() => parseDetections('<html><body>Service unavailable</body></html>'), /missing CSV header/);
  assert.throws(() => parseDetections(''), /missing CSV header/);
});

test('header-only CSV parses to zero events', () => {
  const r = parseDetections(csv());
  assert.equal(r.total, 0);
  assert.equal(r.events.length, 0);
});

test('high-FRP detection is auto-admitted', () => {
  const r = parseDetections(csv(row({ lat: 39.5, lon: -86.2, frp: 60.5 })));
  assert.equal(r.events.length, 1);
  assert.equal(r.admitFrp, 1);
  const evt = r.events[0];
  assert.equal(evt.basis, 'high-intensity');
  assert.equal(evt.severity, 'Extreme');
  assert.equal(evt.lat, 39.5);
  assert.equal(evt.lon, -86.2);
});

test('low-FRP uncorroborated detection is dropped', () => {
  const r = parseDetections(csv(row({ lat: 39.5, lon: -86.2, frp: 5 })));
  assert.equal(r.events.length, 0);
  assert.equal(r.dropUncorroborated, 1);
});

test('low-FRP detection near an active NIFC fire is admitted', () => {
  const fires = [{ lat: 39.51, lon: -86.21, acres: 100 }];
  const r = parseDetections(csv(row({ lat: 39.5, lon: -86.2, frp: 5 })), fires);
  assert.equal(r.events.length, 1);
  assert.equal(r.admitNifc, 1);
  assert.equal(r.events[0].basis, 'nifc-confirmed');
});

test('detection near an elevated volcano is suppressed', () => {
  const volcs = [{ lat: 39.52, lon: -86.22 }];
  const r = parseDetections(csv(row({ lat: 39.5, lon: -86.2, frp: 200 })), [], volcs);
  assert.equal(r.events.length, 0);
  assert.equal(r.dropVolcano, 1);
});

test('low-confidence detections are dropped', () => {
  const r = parseDetections(csv(row({ lat: 39.5, lon: -86.2, frp: 200, confidence: 'low' })));
  assert.equal(r.events.length, 0);
});

test('foreign detections are dropped', () => {
  const r = parseDetections(csv(row({ lat: 19.43, lon: -99.13, frp: 200 }))); // Mexico City
  assert.equal(r.events.length, 0);
});

test('detections deduplicate at 2-decimal precision', () => {
  const r = parseDetections(csv(
    row({ lat: 39.501, lon: -86.201, frp: 60 }),
    row({ lat: 39.504, lon: -86.204, frp: 70 })
  ));
  assert.equal(r.total, 2);
  assert.equal(r.events.length, 1);
});

test('malformed rows are skipped without throwing', () => {
  const r = parseDetections(csv('not,a,valid,row', row({ lat: 39.5, lon: -86.2, frp: 60 })));
  assert.equal(r.events.length, 1);
});

test('corrRadiusKm scales with acreage and is capped', () => {
  assert.equal(corrRadiusKm(0), 2);                 // georeferencing tolerance only
  assert.ok(corrRadiusKm(1000) > corrRadiusKm(10)); // grows with fire size
  assert.equal(corrRadiusKm(1e9), 15);              // capped at CORR_MAX_KM
  assert.equal(corrRadiusKm(-5), 2);                // negative acreage clamped
});
