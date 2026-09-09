const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSurvey, severity } = require('../sources/dat');

const NOW = 1789000000000;
const DAY = 86400000;
const track = (props = {}, coords = [[-90.4, 30.5], [-90.3, 30.55], [-90.2, 30.6]]) => ({
  type: 'Feature',
  properties: {
    event_id: 'Hammond, LA Tornado', stormdate: NOW - 2 * DAY, starttime: NOW - 2 * DAY, efscale: 'EF1', efnum: 1,
    length: 0.7675, width: 40, injuries: 0, fatalities: 0, maxwind: 95, wfo: 'LIX', comments: 'Survey complete.',
    created_date: NOW - DAY, last_edited_date: NOW - DAY + 3600000, globalid: '{ABC-123}', ...props
  },
  geometry: { type: 'LineString', coordinates: coords }
});

test('a recent surveyed track becomes a rated LineString event', () => {
  const e = normalizeSurvey(track(), NOW);
  assert.equal(e.id, 'dat-{ABC-123}');
  assert.equal(e.category, 'Tornado Damage Survey');
  assert.equal(e.rating, 'EF1');
  assert.equal(e.efnum, 1);
  assert.equal(e.headline, 'EF1 — Hammond, LA Tornado');
  assert.equal(e.geometry.type, 'LineString');
  assert.equal(e.timestamp, NOW - DAY + 3600000);    // publish/edit time drives the display window
  assert.equal(e.stormDate, NOW - 2 * DAY);
  assert.equal(e.lengthMi, 0.8);
  assert.equal(e.widthYd, 40);
  assert.equal(e.areaDesc, 'NWS LIX');
});

test('old storms re-edited recently are dropped (the service keeps every survey since 2010)', () => {
  assert.equal(normalizeSurvey(track({ stormdate: NOW - 400 * DAY, starttime: NOW - 400 * DAY }), NOW), null);
  assert.equal(normalizeSurvey(track({ stormdate: null, starttime: null }), NOW), null);
  // stormdate missing but starttime recent is fine
  assert.notEqual(normalizeSurvey(track({ stormdate: null }), NOW), null);
});

test('rating falls back to efscale text, then Unrated', () => {
  assert.equal(normalizeSurvey(track({ efnum: null, efscale: 'EF3' }), NOW).rating, 'EF3');
  assert.equal(normalizeSurvey(track({ efnum: null, efscale: 'EFU' }), NOW).rating, 'EFU');
  assert.equal(normalizeSurvey(track({ efnum: -1, efscale: 'EFU' }), NOW).rating, 'EFU');
  assert.equal(normalizeSurvey(track({ efnum: -1, efscale: 'EFU' }), NOW).efnum, null);
  assert.equal(normalizeSurvey(track({ efnum: 0, efscale: null }), NOW).rating, 'EF0');
});

test('straight-line wind damage paths in the same layer are not tornado tracks', () => {
  assert.equal(normalizeSurvey(track({ efnum: -1, efscale: 'TSTM/Wind' }), NOW), null);
  assert.equal(normalizeSurvey(track({ efnum: null, efscale: null }), NOW), null);
});

test('a numeric or missing event_id gets a name from the office', () => {
  assert.equal(normalizeSurvey(track({ event_id: '3' }), NOW).headline, 'EF1 — Tornado (NWS LIX)');
  assert.equal(normalizeSurvey(track({ event_id: null, wfo: null }), NOW).headline, 'EF1 — Tornado');
});

test('severity and color scale with the EF number', () => {
  assert.equal(severity(0), 'Moderate');
  assert.equal(severity(2), 'Severe');
  assert.equal(severity(4), 'Extreme');
  const ef0 = normalizeSurvey(track({ efnum: 0, efscale: 'EF0' }), NOW);
  const ef4 = normalizeSurvey(track({ efnum: 4, efscale: 'EF4' }), NOW);
  assert.notEqual(ef0.color, ef4.color);
  assert.equal(ef4.severity, 'Extreme');
});

test('non-line or degenerate geometry is dropped', () => {
  assert.equal(normalizeSurvey({ properties: track().properties, geometry: { type: 'Point', coordinates: [0, 0] } }, NOW), null);
  assert.equal(normalizeSurvey(track({}, [[-90.4, 30.5]]), NOW), null);
  assert.equal(normalizeSurvey({ properties: track().properties, geometry: null }, NOW), null);
});
