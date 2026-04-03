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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://hazardpulse:hazardpulse@db:5432/hazardpulse'
});

// State abbreviation → FIPS code (Broadcastify stid = state FIPS)
const STATE_FIPS = {
  'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09',
  'DE':'10','DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17',
  'IN':'18','IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24',
  'MA':'25','MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31',
  'NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38',
  'OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46',
  'TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
  'WI':'55','WY':'56'
};

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
