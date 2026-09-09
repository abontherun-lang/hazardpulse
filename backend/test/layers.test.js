const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { registry, TYPES, colorOf, has, legendTypes } = require('../layers');

// Categories the source modules write. Every one must be registered or it
// renders nowhere and toggles nothing. Keep in sync with the sources.
const SOURCE_CATEGORIES = [
  'Earthquake', 'Wildfire', 'Wildfire Incident', 'Volcano', 'Tornado Report',
  'Protest', 'Armed Violence', 'Use of Force',
  'Official Alerts', 'Missing Persons',
  'Dispatch Fire', 'Dispatch Violence', 'Dispatch Accident', 'Dispatch Hazmat'
];

test('every legend row type is registered, and each type has exactly one row', () => {
  const seen = new Map();
  for (const g of registry.groups) {
    for (const r of g.rows) {
      assert.ok(r.types.length > 0, `${g.key}: row "${r.label}" has no types`);
      for (const t of r.types) {
        assert.ok(has(t), `${g.key}: "${t}" is in a legend row but not in types`);
        assert.ok(!seen.has(t), `"${t}" appears in rows "${seen.get(t)}" and "${r.label}"`);
        seen.set(t, r.label);
      }
    }
  }
  for (const t of Object.keys(TYPES)) assert.ok(seen.has(t), `"${t}" has no legend row`);
  assert.equal(legendTypes().length, Object.keys(TYPES).length);
});

test('every type has a hex color and a known style', () => {
  for (const [t, def] of Object.entries(TYPES)) {
    assert.match(def.color, /^#[0-9A-Fa-f]{6}$/, `${t} color`);
    assert.ok(['fill', 'dashed', 'dot'].includes(def.style), `${t} style ${def.style}`);
    if (def.border) assert.match(def.border, /^#[0-9A-Fa-f]{6}$/, `${t} border`);
  }
});

test('every category a source writes is registered', () => {
  for (const c of SOURCE_CATEGORIES) assert.ok(has(c), `source category "${c}" missing from layers.json`);
});

test('NOAA target events are registered', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sources', 'noaa.js'), 'utf-8');
  const m = src.match(/const TARGET_EVENTS = \[([\s\S]*?)\];/);
  assert.ok(m, 'TARGET_EVENTS not found');
  const events = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(events.length > 10);
  for (const e of events) assert.ok(has(e), `NOAA event "${e}" missing from layers.json`);
});

test('presets reference real groups and types', () => {
  const groups = new Set(registry.groups.map(g => g.key));
  for (const [name, p] of Object.entries(registry.presets)) {
    if (p.types) for (const t of p.types) assert.ok(has(t), `preset ${name}: type "${t}"`);
    else if (p.groups !== '*') for (const g of p.groups) assert.ok(groups.has(g), `preset ${name}: group "${g}"`);
    else assert.equal(p.groups, '*');
  }
  for (const name of ['all', 'critical', 'weather', 'seismic', 'fire', 'conflict']) assert.ok(registry.presets[name], `preset ${name}`);
});

test('colorOf returns the registered color or the fallback', () => {
  assert.equal(colorOf('Protest'), '#F9A825');
  assert.equal(colorOf('Nope'), '#808080');
  assert.equal(colorOf('Nope', '#123456'), '#123456');
});

test('the dispatch hint lists the live feeds', () => {
  const hint = registry.groups.find(g => g.key === 'dispatch').hint;
  assert.match(hint, /Seattle/);
  assert.doesNotMatch(hint, /Cincinnati/);
});

test('index.html carries no hardcoded layer rows', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf-8');
  assert.doesNotMatch(html, /data-type=/);
  assert.match(html, /id="legend-groups"/);
});
