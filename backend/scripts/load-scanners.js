#!/usr/bin/env node
/**
 * load-scanners.js — Import scanner_lookup.json and state FIPS codes into PostGIS.
 *
 * Usage:
 *   node backend/scripts/load-scanners.js
 *   (or automatically called by db.js on first startup)
 *
 * Idempotent: clears and reloads on every run.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { STATE_FIPS } = require('../sources/geo');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://hazardpulse:hazardpulse@db:5432/hazardpulse'
});

async function load() {
  const client = await pool.connect();
  try {
    // Load scanner lookup JSON
    const jsonPath = path.join(__dirname, '..', '..', 'frontend', 'scanner_lookup.json');
    if (!fs.existsSync(jsonPath)) {
      console.error('scanner_lookup.json not found at', jsonPath);
      return;
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const entries = Object.entries(data);
    console.log(`Loading ${entries.length} scanner entries...`);

    await client.query('BEGIN');

    // Clear and reload
    await client.query('DELETE FROM scanners');
    await client.query('DELETE FROM state_fips');

    // Batch insert scanners (1000 per batch)
    const BATCH = 1000;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let idx = 1;
      for (const [key, channelId] of batch) {
        const pipe = key.indexOf('|');
        if (pipe === -1) continue;
        const name = key.slice(0, pipe);
        const state = key.slice(pipe + 1);
        values.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
        params.push(name, state, channelId);
        idx += 3;
      }
      if (values.length > 0) {
        await client.query(
          `INSERT INTO scanners (name, state_abbr, channel_id) VALUES ${values.join(',')}
           ON CONFLICT (name, state_abbr) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
          params
        );
      }
    }

    // Insert state FIPS
    const fipsValues = [];
    const fipsParams = [];
    let fIdx = 1;
    for (const [abbr, fips] of Object.entries(STATE_FIPS)) {
      fipsValues.push(`($${fIdx}, $${fIdx + 1})`);
      fipsParams.push(abbr, fips);
      fIdx += 2;
    }
    await client.query(
      `INSERT INTO state_fips (state_abbr, fips) VALUES ${fipsValues.join(',')}
       ON CONFLICT (state_abbr) DO UPDATE SET fips = EXCLUDED.fips`,
      fipsParams
    );

    await client.query('COMMIT');
    console.log(`✓ Loaded ${entries.length} scanner entries and ${Object.keys(STATE_FIPS).length} state FIPS codes`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Run directly or export for use by db.js
if (require.main === module) {
  load().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { load };
}
