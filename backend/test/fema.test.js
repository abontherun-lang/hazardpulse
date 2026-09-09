const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, parsePolygon, parseCircle, decodeXml } = require('../sources/fema');

test('decodeXml turns CAP entities into plain text, &amp; last', () => {
  assert.equal(decodeXml('Sheriff&apos;s Office &amp; Fire'), "Sheriff's Office & Fire");
  assert.equal(decodeXml('&#39;quoted&#39; &#x26; &lt;tag&gt;'), `'quoted' & <tag>`);
  assert.equal(decodeXml('&amp;lt;'), '&lt;');
});

test('classify routes missing-person, fire, and civil alerts', () => {
  assert.equal(classify('Child Abduction Emergency', 'AMBER Alert').category, 'Missing Persons');
  assert.equal(classify('Fire Warning', 'Evacuate now').category, 'Wildfire');
  assert.equal(classify('Civil Emergency Message', 'Boil water').category, 'Official Alerts');
});

test('classify skips tests, demos, and NWS weather duplicates', () => {
  assert.equal(classify('Required Weekly Test', ''), null);
  assert.equal(classify('Demo Warning', 'practice'), null);
  assert.equal(classify('Tornado Warning', ''), null);
  // "protest" must not match the \btest\b skip
  assert.notEqual(classify('Local Area Emergency', 'protest downtown'), null);
});

test('parsePolygon closes an open ring and rejects degenerate input', () => {
  const p = parsePolygon('39.7,-86.2 39.8,-86.2 39.8,-86.1');
  assert.equal(p.type, 'Polygon');
  assert.equal(p.coordinates[0].length, 4);
  assert.deepEqual(p.coordinates[0][0], [-86.2, 39.7]);
  assert.deepEqual(p.coordinates[0][3], p.coordinates[0][0]);
  assert.equal(parsePolygon('39.7,-86.2 39.8,-86.2'), null);
});

test('parseCircle yields the center point', () => {
  assert.deepEqual(parseCircle('39.7,-86.2 5.0'), { type: 'Point', coordinates: [-86.2, 39.7] });
  assert.equal(parseCircle('x,y 5'), null);
});
