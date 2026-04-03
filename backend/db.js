/**
 * PostgreSQL/PostGIS connection module.
 *
 * Mirrors the pattern of redis-client.js:
 *   const { pool, connect } = require('./db');
 */

const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://hazardpulse:hazardpulse@db:5432/hazardpulse',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

/**
 * Connect to PostgreSQL, run schema initialization, verify TIGER data,
 * and auto-load scanner data. Call once at startup before any queries.
 */
async function connect() {
  // Retry connection — PostGIS may still be finishing init after healthcheck passes
  let client;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt === 10) throw e;
      console.log(`Waiting for PostgreSQL (attempt ${attempt}/10)...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('✓ Connected to PostgreSQL');
  try {

    // Run schema (idempotent)
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schema);
    console.log('✓ Schema initialized');

    // Auto-load TIGER boundary data if not present
    const tigerCheck = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tiger_states') AS exists"
    );
    const tigerExists = tigerCheck.rows[0].exists;
    const tigerCount = tigerExists
      ? parseInt((await client.query('SELECT COUNT(*) FROM tiger_states')).rows[0].count)
      : 0;

    if (tigerCount === 0) {
      console.log('⏳ Loading Census TIGER/Line boundary data (first startup, ~2-3 min)...');
      try {
        execSync('sh /app/backend/scripts/load-tiger.sh', {
          stdio: 'inherit',
          env: { ...process.env, DATABASE_URL: pool.options.connectionString || process.env.DATABASE_URL }
        });
      } catch (e) {
        console.error('⚠ TIGER/Line load had errors:', e.message);
      }
      // Verify at least states loaded (minimum for reverse geocoding)
      const verifyCheck = await client.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tiger_states') AS e"
      );
      if (!verifyCheck.rows[0].e) {
        throw new Error('TIGER/Line data load failed completely. Check network and try again.');
      }
      const newCount = await client.query('SELECT COUNT(*) FROM tiger_states');
      if (parseInt(newCount.rows[0].count) === 0) {
        throw new Error('TIGER/Line data load failed completely. Check network and try again.');
      }
      console.log(`✓ TIGER/Line data loaded (${newCount.rows[0].count} states)`);
    } else {
      console.log(`✓ TIGER/Line data loaded (${tigerCount} states)`);
    }

    // Auto-load scanner data if table is empty
    const scannerCount = await client.query('SELECT COUNT(*) FROM scanners');
    if (parseInt(scannerCount.rows[0].count) === 0) {
      console.log('⏳ Loading scanner lookup data...');
      const { load } = require('./scripts/load-scanners');
      await load();
    } else {
      console.log(`✓ Scanner data loaded (${scannerCount.rows[0].count} entries)`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, connect };
