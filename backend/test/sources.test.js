// Every registered source honours the module interface.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cron = require('node-cron');
const { pool } = require('../db');
pool.query = async () => ({ rows: [], rowCount: 0 });
const { SOURCES } = require('../server');
const { has } = require('../layers');

test('eleven sources, each with fetch, unique names and prefixes, and a valid cron', () => {
  assert.equal(SOURCES.length, 11);
  const names = new Set(), prefixes = new Set();
  for (const s of SOURCES) {
    assert.equal(typeof s.fetch, 'function', s.SOURCE_NAME);
    assert.equal(typeof s.SOURCE_NAME, 'string');
    assert.equal(typeof s.PREFIX, 'string');
    assert.ok(cron.validate(s.CRON_SCHEDULE), `${s.SOURCE_NAME}: cron ${s.CRON_SCHEDULE}`);
    assert.ok(!names.has(s.SOURCE_NAME), `duplicate SOURCE_NAME ${s.SOURCE_NAME}`);
    assert.ok(!prefixes.has(s.PREFIX), `duplicate PREFIX ${s.PREFIX}`);
    names.add(s.SOURCE_NAME); prefixes.add(s.PREFIX);
    assert.equal(s.getActive, undefined, `${s.SOURCE_NAME} still exports the dead getActive()`);
  }
});

test('AFTER names real sources and never itself', () => {
  const names = new Set(SOURCES.map(s => s.SOURCE_NAME));
  for (const s of SOURCES) {
    if (!s.AFTER) continue;
    assert.ok(Array.isArray(s.AFTER) && s.AFTER.length > 0, s.SOURCE_NAME);
    for (const dep of s.AFTER) {
      assert.ok(names.has(dep), `${s.SOURCE_NAME} AFTER unknown source ${dep}`);
      assert.notEqual(dep, s.SOURCE_NAME);
    }
  }
  assert.deepEqual(SOURCES.find(s => s.PREFIX === 'fire').AFTER, ['NIFC', 'USGS Volcano']);
});

test('no source requires axios directly — http.js is the one client', () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'sources');
  const files = [...fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f)),
    ...fs.readdirSync(path.join(dir, 'adapters')).map(f => path.join(dir, 'adapters', f))];
  for (const f of files) assert.ok(!/require\(['"]axios['"]\)/.test(fs.readFileSync(f, 'utf-8')), path.basename(f));
});

test('the fallback and every hardcoded category are registered', () => {
  for (const c of ['Tornado Report', 'Tornado Damage Survey', 'Wildfire', 'Wildfire Incident', 'Volcano', 'Earthquake', 'Other NWS Alert']) assert.ok(has(c), c);
});
