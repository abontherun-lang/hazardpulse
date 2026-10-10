// NHC storm products, against the Isaias (AT4) advisory 14 fixtures recorded 2026-10-10.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CATEGORY, SS_COLORS, RADII_COLORS,
  saffirSimpson, describeStorm, compass, layerIds, parseStormId, belongsTo,
  normalizeCenter, normalizeProducts, roundGeometry
} = require('../sources/nhc');
const { has } = require('../layers');

const FIX = path.join(__dirname, 'fixtures', 'nhc-at4-2026-10-10');
const load = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf-8'));
const index = load('CurrentStorms.json');
const isaias = index.activeStorms.find(s => s.id === 'al092026');
const products = {
  points: load('forecast-points.geojson'),
  track: load('forecast-track.geojson'),
  cone: load('forecast-cone.geojson'),
  wind: load('wind-field.geojson')
};
const NOW = 1791603600000; // 2026-10-10T03:20Z, just after the advisory

test('Saffir-Simpson thresholds in knots', () => {
  assert.equal(saffirSimpson(63), 0);
  assert.equal(saffirSimpson(64), 1);
  assert.equal(saffirSimpson(82), 1);
  assert.equal(saffirSimpson(83), 2);
  assert.equal(saffirSimpson(96), 3);
  assert.equal(saffirSimpson(113), 4);
  assert.equal(saffirSimpson(137), 5);
  assert.equal(saffirSimpson(null), 0);
});

test('describeStorm: classification + intensity → label, tag, color', () => {
  assert.deepEqual(describeStorm('HU', 80), { label: 'Category 1 Hurricane', kind: 'Hurricane', cat: 1, tag: 'H1', color: SS_COLORS[1] });
  assert.equal(describeStorm('HU', 120).tag, 'H4');
  assert.equal(describeStorm('TS', 40).tag, 'TS');
  assert.equal(describeStorm('TD', 25).label, 'Tropical Depression');
  assert.equal(describeStorm('STS', 45).tag, 'SS');
  assert.equal(describeStorm('PTC', 30).tag, 'PTC');
  // a storm the index still calls TS but with hurricane-force winds is a hurricane
  assert.equal(describeStorm('TS', 70).tag, 'H1');
});

test('compass points', () => {
  assert.equal(compass(5), 'N');
  assert.equal(compass(50), 'NE');
  assert.equal(compass(270), 'W');
  assert.equal(compass(359), 'N');
  assert.equal(compass(undefined), '');
});

test('the index entry becomes a center point with the advisory facts', () => {
  const e = normalizeCenter(isaias, NOW);
  assert.equal(e.id, 'nhc-al092026-center');
  assert.equal(e.category, CATEGORY.CENTER);
  assert.ok(has(e.category));
  assert.equal(e.headline, 'Hurricane Isaias');
  assert.equal(e.status, 'Category 1 Hurricane');
  assert.equal(e.tag, 'H1');
  assert.equal(e.severity, 'Severe');
  assert.equal(e.color, SS_COLORS[1]);
  assert.deepEqual(e.geometry, { type: 'Point', coordinates: [-86.5, 30.8] });
  assert.equal(e.windKt, 80);
  assert.equal(e.windMph, 92);
  assert.equal(e.pressureMb, 982);
  assert.equal(e.moveDir, 'N');
  assert.equal(e.moveMph, 23);
  assert.equal(e.advisory, '14');
  assert.equal(e.timestamp, Date.parse('2026-10-10T03:00:00.000Z'));
  assert.match(e.sourceUrl, /MIATCPAT4/);
  assert.match(e.graphicsUrl, /graphics_at4/);
  assert.match(e.description, /92 mph, moving N at 23 mph, 982 mb/);
});

test('a storm without a position is skipped', () => {
  assert.equal(normalizeCenter({ id: 'al992026', name: 'x' }, NOW), null);
});

test('products: one cone, one track, five forecast points, three wind rings', () => {
  const events = normalizeProducts(isaias, products, NOW);
  const by = p => events.filter(e => e.product === p);
  assert.equal(by('cone').length, 1);
  assert.equal(by('track').length, 1);
  assert.equal(by('point').length, 5);
  assert.equal(by('wind').length, 3);
  assert.equal(events.length, 10);

  const cone = by('cone')[0];
  assert.equal(cone.id, 'nhc-al092026-cone');
  assert.equal(cone.category, CATEGORY.FORECAST);
  assert.ok(has(cone.category));
  assert.equal(cone.geometry.type, 'Polygon');
  assert.equal(cone.advisory, '14');
  assert.equal(cone.hours, 120);
  assert.equal(cone.timestamp, 1791602904000);          // idp_filedate
  assert.match(cone.headline, /Isaias — forecast cone, advisory 14/);

  const track = by('track')[0];
  assert.equal(track.geometry.type, 'LineString');
  assert.equal(track.geometry.coordinates.length, 5);

  const pts = by('point').sort((a, b) => a.tau - b.tau);
  assert.deepEqual(pts.map(p => p.tau), [0, 12, 24, 36, 48]);
  assert.deepEqual(pts.map(p => p.id), [0, 12, 24, 36, 48].map(t => `nhc-al092026-fcst-${t}`));
  assert.equal(pts[0].letter, 'H');
  assert.equal(pts[0].status, 'Hurricane');
  assert.equal(pts[0].windMph, 92);
  assert.equal(pts[0].gustMph, 121);
  assert.equal(pts[0].color, SS_COLORS[1]);
  assert.equal(pts[0].label, '10:00 PM Fri');
  assert.equal(pts[1].status, 'Subtropical Storm');
  assert.equal(pts[1].letter, 'S');
  assert.equal(pts[2].letter, 'D');

  const rings = by('wind').sort((a, b) => a.radii - b.radii);
  assert.deepEqual(rings.map(r => r.radii), [34, 50, 64]);
  assert.deepEqual(rings.map(r => r.id), ['nhc-al092026-wind-34', 'nhc-al092026-wind-50', 'nhc-al092026-wind-64']);
  assert.equal(rings[0].category, CATEGORY.WIND);
  assert.ok(has(rings[0].category));
  assert.equal(rings[0].color, RADII_COLORS[34]);
  assert.equal(rings[0].radiiMph, 39);
  assert.equal(rings[2].radiiMph, 74);
  assert.equal(rings[2].severity, 'Severe');
  assert.deepEqual(rings[0].quadrantsNm, { ne: 100, se: 140, sw: 90, nw: 100 });
});

test('a reused bin still holding another storm stores nothing for this one', () => {
  const rachel = index.activeStorms.find(s => s.id === 'ep182026');
  assert.ok(rachel);
  // Rachel's products fetched from a bin that still carries Isaias' features
  assert.deepEqual(normalizeProducts(rachel, products, NOW), []);
  assert.equal(belongsTo(isaias, { basin: 'AL', stormnum: 9 }), true);
  assert.equal(belongsTo(isaias, { stormid: 'al092026' }), true);
  assert.equal(belongsTo(isaias, { stormid: 'ep182026' }), false);
  assert.equal(belongsTo(isaias, { basin: 'EP', stormnum: 9 }), false);
});

test('a missing product leaves the others intact', () => {
  const events = normalizeProducts(isaias, { cone: products.cone }, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].product, 'cone');
});

test('coordinates are rounded to 4 places, cutting the cone payload', () => {
  const raw = JSON.stringify(products.cone.features[0].geometry).length;
  const rounded = JSON.stringify(roundGeometry(products.cone.features[0].geometry)).length;
  assert.ok(rounded < raw * 0.6, `${rounded} vs ${raw}`);
  assert.deepEqual(roundGeometry({ type: 'Point', coordinates: [-86.4999999997001, 30.79999999970039] }).coordinates, [-86.5, 30.8]);
  assert.equal(roundGeometry(null), null);
});

test('layer ids resolve by bin + product name from the service metadata', () => {
  const meta = { layers: [
    { id: 82, name: 'AT4' }, { id: 84, name: 'AT4 Forecast Points' }, { id: 85, name: 'AT4 Forecast Track' },
    { id: 86, name: 'AT4 Forecast Cone' }, { id: 95, name: 'AT4 Advisory Wind Field' },
    { id: 188, name: 'EP3 Forecast Points' }
  ] };
  assert.deepEqual(layerIds(meta, 'AT4'), { points: 84, track: 85, cone: 86, wind: 95 });
  assert.deepEqual(layerIds(meta, 'EP3'), { points: 188 });
  assert.deepEqual(layerIds({}, 'CP1'), {});
});

test('storm ids parse to basin + number', () => {
  assert.deepEqual(parseStormId('al092026'), { basin: 'AL', stormnum: 9, year: 2026 });
  assert.deepEqual(parseStormId('EP182026'), { basin: 'EP', stormnum: 18, year: 2026 });
  assert.equal(parseStormId('nope'), null);
});

test('every id keeps one geometry type across advisories (the store keeps old polygons over new points)', () => {
  const events = [normalizeCenter(isaias, NOW), ...normalizeProducts(isaias, products, NOW)];
  const want = { center: 'Point', cone: 'Polygon', track: 'LineString', point: 'Point', wind: 'Polygon' };
  for (const e of events) assert.equal(e.geometry.type, want[e.product], e.id);
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
});
