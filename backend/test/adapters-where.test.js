const { test } = require('node:test');
const assert = require('node:assert/strict');
const socrata = require('../sources/adapters/socrata');
const arcgis = require('../sources/adapters/arcgis');

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);
const FEED = { fields: { type: 'call_type', time: 'dispatch_time', lat: 'latitude', lon: 'longitude' }, crisisTypes: ["STRUCTURE FIRE", "PERSON W/GUN", "O'BRIEN"], hoursBack: 4 };

test('socrata: 24h padded window, quoted type list with escaped apostrophes, coordinate guard', () => {
  const where = socrata.buildWhere(FEED, NOW);
  assert.equal(where, `dispatch_time > '2026-09-07T12:00:00.000' AND call_type IN ('STRUCTURE FIRE','PERSON W/GUN','O''BRIEN') AND latitude IS NOT NULL`);
});

test('socrata: priority filter and geoPoint guard', () => {
  const feed = { fields: { type: 't', time: 'ts', geoPoint: 'pt' }, priorityFilter: { field: 'priority', values: ['A', "B'"] } };
  const where = socrata.buildWhere(feed, NOW);
  assert.match(where, /priority IN \('A','B'''\)/);
  assert.match(where, /pt IS NOT NULL$/);
  assert.equal(socrata.buildWhere({ fields: {} }, NOW), '');
});

test('arcgis: TIMESTAMP keyword, hoursBack honoured, 1=1 when nothing to filter', () => {
  const where = arcgis.buildWhere(FEED, NOW);
  assert.equal(where, `dispatch_time > TIMESTAMP '2026-09-08 08:00:00' AND call_type IN ('STRUCTURE FIRE','PERSON W/GUN','O''BRIEN') AND latitude IS NOT NULL`);
  assert.equal(arcgis.buildWhere({ fields: {} }, NOW), '1=1');
});
