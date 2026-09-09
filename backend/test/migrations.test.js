const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unescapeHtml, deepUnescape, MIGRATIONS } = require('../migrations');

test('unescapeHtml reverses the old store-time escaping, &amp; last', () => {
  assert.equal(unescapeHtml('Little Fisher&#x27;s Mesa'), "Little Fisher's Mesa");
  assert.equal(unescapeHtml('A&amp;W Fire'), 'A&W Fire');
  assert.equal(unescapeHtml('&lt;b&gt;&quot;x&quot;&lt;/b&gt;'), '<b>"x"</b>');
  assert.equal(unescapeHtml('&amp;lt;'), '&lt;'); // double-escaped stays single-escaped
  assert.equal(unescapeHtml('plain'), 'plain');
});

test('deepUnescape walks props JSON without touching non-strings', () => {
  const out = deepUnescape({ city: 'Seattle, WA', instruction: 'Don&#x27;t wait', n: 3, tags: ['a&amp;b'], nested: { x: '&quot;' } });
  assert.deepEqual(out, { city: 'Seattle, WA', instruction: "Don't wait", n: 3, tags: ['a&b'], nested: { x: '"' } });
});

test('migration keys are unique and dated', () => {
  const keys = MIGRATIONS.map(m => m.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
});
