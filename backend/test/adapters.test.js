const { test } = require('node:test');
const assert = require('node:assert/strict');
const socrata = require('../sources/adapters/socrata');
const arcgis = require('../sources/adapters/arcgis');

const FEED = {
  id: 'testcity',
  city: 'Testville',
  state: 'IN',
  fields: { id: 'incident_id', type: 'call_type', time: 'dispatch_time', lat: 'latitude', lon: 'longitude', address: 'block_address' },
  categoryMap: { 'STRUCTURE FIRE': 'Dispatch Fire' }
};

test('socrata normalize maps fields and categories', () => {
  const incident = socrata.normalize({
    incident_id: 'F123',
    call_type: 'STRUCTURE FIRE',
    dispatch_time: '2026-06-10T12:00:00',
    latitude: '39.77',
    longitude: '-86.16',
    block_address: '100 MAIN ST'
  }, FEED);
  assert.equal(incident.id, 'F123');
  assert.equal(incident.category, 'Dispatch Fire');
  assert.equal(incident.lat, 39.77);
  assert.equal(incident.lon, -86.16);
  assert.equal(incident.address, '100 MAIN ST');
  assert.equal(incident.city, 'Testville, IN');
});

test('socrata normalize defaults unmapped types to Dispatch Other', () => {
  const incident = socrata.normalize(
    { incident_id: '1', call_type: 'CAT IN TREE', latitude: '39.7', longitude: '-86.1' }, FEED);
  assert.equal(incident.category, 'Dispatch Other');
  assert.equal(incident.type, 'CAT IN TREE');
});

test('socrata normalize extracts geoPoint coordinates', () => {
  const feed = { ...FEED, fields: { ...FEED.fields, lat: undefined, lon: undefined, geoPoint: 'intersection_point' } };
  const incident = socrata.normalize(
    { incident_id: '1', call_type: 'X', intersection_point: { coordinates: [-122.4, 37.77] } }, feed);
  assert.equal(incident.lat, 37.77);
  assert.equal(incident.lon, -122.4);
});

test('socrata normalize rejects rows without usable coordinates', () => {
  assert.equal(socrata.normalize({ incident_id: '1', call_type: 'X' }, FEED), null);
  const feed = { ...FEED, fields: { ...FEED.fields, lat: undefined, lon: undefined, geoPoint: 'pt' } };
  assert.equal(socrata.normalize({ incident_id: '1', pt: null }, feed), null);
});

test('socrata normalize builds a fallback id', () => {
  const incident = socrata.normalize(
    { call_type: 'X', latitude: '39.7', longitude: '-86.1' }, FEED);
  assert.ok(incident.id.startsWith('testcity_'));
});

test('arcgis normalize maps fields and epoch-ms timestamps', () => {
  const incident = arcgis.normalize({
    incident_id: 'A9',
    call_type: 'STRUCTURE FIRE',
    dispatch_time: 1749571200000,
    latitude: 39.77,
    longitude: -86.16,
    block_address: '200 ELM ST'
  }, FEED);
  assert.equal(incident.id, 'A9');
  assert.equal(incident.category, 'Dispatch Fire');
  assert.equal(incident.time, 1749571200000);
});

test('arcgis normalize rejects null-island and missing coordinates', () => {
  assert.equal(arcgis.normalize({ incident_id: '1', call_type: 'X', latitude: 0, longitude: 0 }, FEED), null);
  assert.equal(arcgis.normalize({ incident_id: '1', call_type: 'X' }, FEED), null);
});
