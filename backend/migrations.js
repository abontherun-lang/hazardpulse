/**
 * One-shot data migrations, recorded in app_meta so each runs exactly once.
 * db.js calls runMigrations() right after the schema is applied.
 *
 * Add a migration by appending { key, run } — keys are dated so the list
 * reads as history. Never edit a migration that has shipped; add a new one.
 */

const ENTITY_PATTERN = '&(amp|lt|gt|quot|#x27|#39);';

function unescapeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function deepUnescape(v) {
  if (typeof v === 'string') return unescapeHtml(v);
  if (Array.isArray(v)) return v.map(deepUnescape);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deepUnescape(x);
    return out;
  }
  return v;
}

// SQL equivalent of unescapeHtml — &amp; last, so "&amp;lt;" becomes "&lt;".
function sqlUnescape(col) {
  return `replace(replace(replace(replace(replace(replace(${col}, '&quot;', '"'), '&#x27;', ''''), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')`;
}

/**
 * Before 2026-09-08 every source HTML-escaped text at store time and the
 * frontend escaped it again at render, so "Fisher's" showed as
 * "Fisher&#x27;s". Text is now stored raw; decode what is already there.
 */
async function unescapeStoredText(client) {
  const cols = ['event', 'category', 'severity', 'headline', 'description', 'area_desc'];
  const textResult = await client.query(
    `UPDATE events SET ${cols.map(c => `${c} = ${sqlUnescape(c)}`).join(', ')}
     WHERE ${cols.map(c => `${c} ~ '${ENTITY_PATTERN}'`).join(' OR ')}`
  );
  const propsResult = await client.query(
    `SELECT id, props FROM events WHERE props::text ~ '${ENTITY_PATTERN}'`
  );
  for (const row of propsResult.rows) {
    await client.query('UPDATE events SET props = $2 WHERE id = $1',
      [row.id, JSON.stringify(deepUnescape(row.props))]);
  }
  console.log(`   unescaped ${textResult.rowCount} rows, ${propsResult.rowCount} props`);
}

const MIGRATIONS = [
  { key: '2026-09-08-unescape-stored-text', run: unescapeStoredText },
];

async function runMigrations(client) {
  for (const m of MIGRATIONS) {
    const done = await client.query('SELECT 1 FROM app_meta WHERE key = $1', [m.key]);
    if (done.rowCount > 0) continue;
    console.log(`⏳ Migration ${m.key}...`);
    await m.run(client);
    await client.query('INSERT INTO app_meta (key, value) VALUES ($1, $2)', [m.key, 'done']);
    console.log(`✓ Migration ${m.key} applied`);
  }
}

module.exports = { runMigrations, unescapeHtml, deepUnescape, MIGRATIONS };
