const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, getExportUrls } = require('../sources/gdelt');

// GDELT v2 export rows are 61 tab-separated columns. Only the ones parseCsv
// reads need real values: 0=GlobalEventID, 1=Day (YYYYMMDD), 26=EventCode,
// 28=EventRootCode, 33=NumArticles, 52=ActionGeo_FullName,
// 53=ActionGeo_CountryCode, 56=lat, 57=lon, 60=SourceURL
function row(overrides = {}) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cols = new Array(61).fill('');
  cols[0] = overrides.id ?? '123456789';
  cols[1] = overrides.date ?? today;
  cols[26] = overrides.eventCode ?? '140';
  cols[28] = overrides.rootCode ?? '14';
  cols[33] = overrides.numArticles ?? '5';
  cols[52] = overrides.geo ?? 'Indianapolis, Indiana, United States';
  cols[53] = overrides.country ?? 'US';
  cols[56] = overrides.lat ?? '39.77';
  cols[57] = overrides.lon ?? '-86.16';
  cols[60] = overrides.url ?? 'https://example.com/article';
  return cols.join('\t');
}

test('accepts a multi-source protest event in the US', () => {
  const events = parseCsv(row(), 1700000000000);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'gdelt-123456789');
  assert.equal(events[0].rootCode, '14');
  assert.equal(events[0].lat, 39.77);
  assert.equal(events[0].fileTimestamp, 1700000000000);
});

test('drops events with fewer than 3 articles', () => {
  assert.equal(parseCsv(row({ numArticles: '2' })).length, 0);
  assert.equal(parseCsv(row({ numArticles: '3' })).length, 1);
});

test('drops blocklisted event codes', () => {
  // 192 (Bombing) is dropped — NLP misreads "bombshell" etc. in US news
  assert.equal(parseCsv(row({ rootCode: '19', eventCode: '192' })).length, 0);
  assert.equal(parseCsv(row({ rootCode: '19', eventCode: '191' })).length, 1);
});

test('drops root codes outside the accepted set', () => {
  assert.equal(parseCsv(row({ rootCode: '17', eventCode: '170' })).length, 0);
});

test('drops non-US events outside the US bounding box', () => {
  assert.equal(parseCsv(row({ country: 'MX', lat: '19.43', lon: '-99.13' })).length, 0);
});

test('keeps US-coded events and falls back to bounding box', () => {
  // Country code blank but coordinates inside the US
  assert.equal(parseCsv(row({ country: '' })).length, 1);
});

test('drops events older than 72 hours', () => {
  assert.equal(parseCsv(row({ date: '20200101' })).length, 0);
});

test('drops rows with missing coordinates', () => {
  assert.equal(parseCsv(row({ lat: '', lon: '' })).length, 0);
});

test('skips short rows without throwing', () => {
  assert.equal(parseCsv('too\tfew\tcolumns').length, 0);
});

test('getExportUrls generates 15-minute interval URLs', () => {
  const urls = getExportUrls(1);
  assert.equal(urls.length, 4);
  for (const u of urls) {
    assert.match(u, /^http:\/\/data\.gdeltproject\.org\/gdeltv2\/\d{14}\.export\.CSV\.zip$/);
  }
});
