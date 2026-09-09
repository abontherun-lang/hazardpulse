const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keepAlert, categoryFor, ALLOW, NEVER, MARINE_RE, MARINE_EXACT, FALLBACK_TYPE } = require('../sources/alert-policy');
const { has } = require('../layers');
const fixture = require('./fixtures/nws-active-2026-09-08.json');

const actual = (event, severity = 'Severe') => ({ event, severity, status: 'Actual', messageType: 'Alert' });

test('every Warning is kept unless it is a marine product', () => {
  for (const e of ['Flash Flood Warning', 'Extreme Heat Warning', 'High Wind Warning', 'Freeze Warning', 'Tornado Warning', 'Red Flag Warning', 'Coastal Flood Warning', 'Dust Storm Warning'])
    assert.equal(keepAlert(actual(e)), true, e);
  for (const e of ['Gale Warning', 'Storm Warning', 'Hazardous Seas Warning', 'Special Marine Warning', 'High Surf Warning', 'Hurricane Force Wind Warning', 'Heavy Freezing Spray Warning'])
    assert.equal(keepAlert(actual(e)), false, e);
});

test('watches, advisories and statements only from the allow-list', () => {
  for (const e of ['Tornado Watch', 'Heat Advisory', 'Winter Weather Advisory', 'Wind Advisory', 'Special Weather Statement', 'Evacuation Immediate'])
    assert.equal(keepAlert(actual(e)), true, e);
  for (const e of ['Small Craft Advisory', 'Flood Advisory', 'Frost Advisory', 'Hydrologic Outlook', 'Air Quality Alert', 'Rip Current Statement', 'Beach Hazards Statement', 'Coastal Flood Advisory', 'Dense Fog Advisory'])
    assert.equal(keepAlert(actual(e)), false, e);
});

test('tests, exercises and cancellations are dropped', () => {
  assert.equal(keepAlert(actual('Test Message')), false);
  assert.equal(keepAlert({ event: 'Tornado Warning', status: 'Exercise', messageType: 'Alert' }), false);
  assert.equal(keepAlert({ event: 'Tornado Warning', status: 'Actual', messageType: 'Cancel' }), false);
  assert.equal(keepAlert({}), false);
  assert.equal(keepAlert(null), false);
});

test('the lists do not overlap', () => {
  for (const e of ALLOW) {
    assert.ok(!NEVER.has(e), e);
    assert.ok(!MARINE_EXACT.has(e) && !MARINE_RE.test(e), `${e} is allow-listed and marine`);
  }
});

test('every allow-listed event has its own legend row; everything else kept lands in the fallback row', () => {
  for (const e of ALLOW) assert.ok(has(e), `${e} needs a layers.json entry`);
  assert.ok(has(FALLBACK_TYPE));
  assert.equal(categoryFor('Tornado Warning'), 'Tornado Warning');
  assert.equal(categoryFor('Some New Warning'), FALLBACK_TYPE);
});

test('against the recorded 2026-09-08 feed: life-safety warnings kept, marine noise dropped', () => {
  const kept = {}, dropped = {};
  for (const a of fixture.alerts) (keepAlert(a) ? kept : dropped)[a.event] = (keepAlert(a) ? kept : dropped)[a.event] || 0;
  for (const a of fixture.alerts) (keepAlert(a) ? kept : dropped)[a.event] += a.count;

  // The review's headline misses, all present in the recording.
  for (const e of ['Flash Flood Warning', 'Extreme Heat Warning', 'High Wind Warning', 'Freeze Warning', 'Heat Advisory', 'Severe Thunderstorm Warning', 'Red Flag Warning'])
    assert.ok(kept[e] > 0, `${e} should be kept (fixture has ${fixture.alerts.filter(a => a.event === e).length} rows)`);
  for (const e of ['Small Craft Advisory', 'Gale Warning', 'Special Marine Warning', 'Test Message', 'Flood Advisory', 'High Surf Advisory', 'Rip Current Statement', 'Air Quality Alert'])
    assert.ok(!kept[e], `${e} should be dropped`);

  const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0);
  assert.ok(keptTotal > 50 && keptTotal < fixture.totalAlerts / 2, `kept ${keptTotal} of ${fixture.totalAlerts}`);

  // Every kept event either has a row or is in the fallback bucket — never lost.
  for (const e of Object.keys(kept)) assert.ok(has(e) || categoryFor(e) === FALLBACK_TYPE, e);
});
