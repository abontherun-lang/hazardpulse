/**
 * HazardPulse — API Server
 *
 * Serves cached hazard data from multiple sources.
 * Each source is a module in sources/ with a consistent interface:
 *   { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX }
 *
 * Data flow:
 *   External APIs → Source modules → PostGIS (persistent store)
 *   PostGIS → in-memory JSON (response cache, rebuilt after every fetch cycle)
 *   /api/all → serves from cache with ETag/304
 *
 * Startup order matters: the HTTP server listens as soon as the database is
 * ready and serves whatever PostGIS already holds. The initial fetch of every
 * source runs after that, so a restart never takes the map offline.
 *
 * To add a new data source:
 * 1. Create sources/yoursource.js (copy usgs.js as template)
 * 2. Add it to the SOURCES array below
 * 3. That's it — cron, caching, and API are automatic
 */

try { require('dotenv').config(); } catch (_) {}
const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const axios = require('axios');
const { connect: connectDb, pool } = require('./db');
const { connect: connectRedis, client } = require('./redis-client');
const { getAllActiveEvents } = require('./sources/common');
const { registry: layerRegistry } = require('./layers');

// ===================== DATA SOURCES =====================
// Each source exports: { fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX }

const SOURCES = [
  require('./sources/noaa'),
  require('./sources/usgs'),
  require('./sources/firms'),
  require('./sources/nifc'),
  require('./sources/volcano'),
  require('./sources/gdelt'),
  require('./sources/fema'),
  require('./sources/dispatch'),
  require('./sources/spc'),
];

// Group sources by cron schedule for efficient scheduling
function groupBySchedule(sources) {
  const groups = {};
  for (const src of sources) {
    const key = src.CRON_SCHEDULE;
    if (!groups[key]) groups[key] = [];
    groups[key].push(src);
  }
  return groups;
}

// ===================== EXPRESS APP =====================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : null;
app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : undefined));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Short cache for JS/CSS so updates are picked up quickly
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'public, max-age=60');
    }
  }
}));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' }
}));

// One manual refresh per minute for the whole server, not per client: a
// refresh hits every upstream API, so a per-IP limit would let N clients
// trigger N full fetch cycles a minute.
const fetchLimiter = rateLimit({
  windowMs: 60 * 1000, max: 1,
  keyGenerator: () => 'global',
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Refresh rate limited. Try again in 60 seconds.' }
});

// ===================== RESPONSE CACHE =====================

let cachedResponse = null;
let cachedEtag = null;
let initialFetchDone = false;

async function rebuildCache() {
  try {
    const { features, meta } = await getAllActiveEvents(SOURCES);
    const data = { type: 'FeatureCollection', features, meta };
    cachedResponse = JSON.stringify(data);
    cachedEtag = `"${Date.now()}"`;

    if (client.isOpen) {
      await client.set('cache:all', cachedResponse);
      await client.set('cache:etag', cachedEtag);
    }

    console.log(`   Cache rebuilt: ${features.length} features`);
  } catch (e) {
    console.error('Cache rebuild failed:', e.message);
  }
}

/**
 * Fetch a set of sources in parallel, log failures, rebuild the cache.
 * Returns { PREFIX: result | { error } } for the manual-refresh response.
 */
async function fetchSources(sources, argsFor = () => []) {
  const results = await Promise.allSettled(sources.map(s => s.fetch(...argsFor(s))));
  const summary = {};
  results.forEach((r, i) => {
    const src = sources[i];
    if (r.status === 'fulfilled') {
      summary[src.PREFIX] = r.value;
    } else {
      summary[src.PREFIX] = { error: r.reason?.message };
      console.error(`${src.SOURCE_NAME} failed:`, r.reason?.message);
    }
  });
  await rebuildCache();
  return summary;
}

// ===================== SERVER LOCATION =====================
// Geolocate server IP once at startup, unless HOME_LAT/HOME_LON are set.

let serverLocation = null;

async function resolveServerLocation() {
  // Allow override via env var: HOME_LAT, HOME_LON
  if (process.env.HOME_LAT && process.env.HOME_LON) {
    serverLocation = {
      lat: parseFloat(process.env.HOME_LAT),
      lon: parseFloat(process.env.HOME_LON),
      label: process.env.HOME_LABEL || 'Home Base',
      source: 'config'
    };
  } else {
    try {
      const res = await axios.get('http://ip-api.com/json/?fields=lat,lon,city,regionName', { timeout: 5000 });
      if (res.data && res.data.lat) {
        serverLocation = {
          lat: res.data.lat,
          lon: res.data.lon,
          label: [res.data.city, res.data.regionName].filter(Boolean).join(', ') || 'Server',
          source: 'ip-geolocation'
        };
        console.log(`✓ Server location: ${serverLocation.label} (${serverLocation.lat}, ${serverLocation.lon})`);
      }
    } catch (e) {
      console.warn('⚠ Could not resolve server location:', e.message);
    }
  }

  // Resolve scanner link for home location
  if (serverLocation) {
    try {
      const scanResult = await pool.query(`
        SELECT COALESCE(sp.channel_id, sc.channel_id) AS channel_id, sf.fips
        FROM (SELECT
          (SELECT clean_place_name(LOWER(name)) FROM tiger_places
            WHERE ST_Intersects(geom, ST_SetSRID(ST_Point($1, $2), 4326)) LIMIT 1) AS city,
          (SELECT LOWER(name) FROM tiger_counties
            WHERE ST_Intersects(geom, ST_SetSRID(ST_Point($1, $2), 4326)) LIMIT 1) AS county,
          (SELECT stusps FROM tiger_states
            WHERE ST_Intersects(geom, ST_SetSRID(ST_Point($1, $2), 4326)) LIMIT 1) AS state_abbr
        ) loc
        LEFT JOIN scanners sp ON sp.name = loc.city AND sp.state_abbr = loc.state_abbr
        LEFT JOIN scanners sc ON sc.name = loc.county AND sc.state_abbr = loc.state_abbr
        LEFT JOIN state_fips sf ON sf.state_abbr = loc.state_abbr
      `, [serverLocation.lon, serverLocation.lat]);

      const row = scanResult.rows[0];
      if (row && row.channel_id) {
        serverLocation.scannerUrl = `https://www.broadcastify.com/listen/ctid/${row.channel_id}`;
      } else if (row && row.fips) {
        serverLocation.scannerUrl = `https://www.broadcastify.com/listen/stid/${row.fips}`;
      }
    } catch (e) {
      console.warn('⚠ Could not resolve home scanner:', e.message);
    }
  }
}

// ===================== WEATHER FORECAST =====================
// Cached wttr.in forecast based on server location. Refreshes every 30 min.

let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchWeather() {
  if (!serverLocation) return null;
  const now = Date.now();
  if (weatherCache && (now - weatherCacheTime) < WEATHER_TTL) return weatherCache;

  try {
    const { lat, lon } = serverLocation;
    const res = await axios.get(`https://wttr.in/${lat},${lon}?format=j1`, { timeout: 8000 });
    const d = res.data;
    const cur = d.current_condition[0];

    weatherCache = {
      location: serverLocation.label,
      current: {
        tempF: parseInt(cur.temp_F),
        feelsLikeF: parseInt(cur.FeelsLikeF),
        condition: cur.weatherDesc[0].value,
        humidity: parseInt(cur.humidity),
        windMph: parseInt(cur.windspeedMiles),
        windDir: cur.winddir16Point
      },
      forecast: d.weather.map(day => ({
        date: day.date,
        highF: parseInt(day.maxtempF),
        lowF: parseInt(day.mintempF),
        condition: day.hourly[4].weatherDesc[0].value
      }))
    };
    weatherCacheTime = now;
    return weatherCache;
  } catch (e) {
    console.warn('⚠ Weather fetch failed:', e.message);
    return weatherCache; // return stale cache if available
  }
}

// ===================== ROUTES =====================

app.get('/api/weather', async (req, res) => {
  const weather = await fetchWeather();
  if (weather) {
    res.json(weather);
  } else {
    res.status(404).json({ error: 'Weather not available' });
  }
});

// Layer registry: groups, legend rows, colors, presets. Static per build.
app.get('/api/layers', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(layerRegistry);
});

app.get('/api/location', (req, res) => {
  if (serverLocation) {
    res.json(serverLocation);
  } else {
    res.status(404).json({ error: 'Location not available' });
  }
});

// 200 while the database answers (even before the first fetch has finished),
// 503 when it does not — that is what the Docker healthcheck watches.
app.get('/api/health', async (req, res) => {
  let pgOk = false;
  try { await pool.query('SELECT 1'); pgOk = true; } catch (_) {}

  res.status(pgOk ? 200 : 503).json({
    status: !pgOk ? 'degraded' : initialFetchDone ? 'healthy' : 'starting',
    redis: client.isOpen ? 'connected' : 'disconnected',
    postgres: pgOk ? 'connected' : 'disconnected',
    initialFetch: initialFetchDone ? 'done' : 'pending',
    sources: SOURCES.map(s => s.SOURCE_NAME),
    cacheSize: cachedResponse ? cachedResponse.length : 0,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/all', async (req, res) => {
  try {
    if (!cachedResponse) await rebuildCache();
    if (!cachedResponse) return res.status(503).json({ error: 'Data not available yet' });
    if (cachedEtag && req.headers['if-none-match'] === cachedEtag) {
      return res.status(304).end();
    }
    res.set('Content-Type', 'application/json');
    res.set('ETag', cachedEtag);
    res.set('Cache-Control', 'public, max-age=60');
    res.send(cachedResponse);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
});

app.post('/api/fetch', fetchLimiter, async (req, res) => {
  try {
    console.log('Manual fetch triggered');
    const summary = await fetchSources(SOURCES);
    res.json({ success: true, ...summary });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ===================== STARTUP =====================

let server = null;

async function start() {
  try {
    await connectDb();
    await connectRedis();
    console.log('✓ Redis connected');

    // Serve whatever PostGIS already holds, then open the port. Every
    // restart is a stale map, never a blank one.
    await rebuildCache();
    server = app.listen(PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${PORT}`);
      console.log(`   Sources: ${SOURCES.map(s => s.SOURCE_NAME).join(', ')}`);
    });

    // Non-blocking — don't fail startup if it errors
    await resolveServerLocation();

    // Initial fetch — all sources in parallel
    console.log('\n📡 Initial fetch...');

    // GDELT: backfill 72h only if no recent data (check MAX event_time, not COUNT)
    let gdeltHours = undefined;
    const gdeltSrc = SOURCES.find(s => s.PREFIX === 'gdelt');
    if (gdeltSrc) {
      const result = await pool.query(
        "SELECT MAX(event_time) AS latest FROM events WHERE source = 'GDELT' AND (expires_at IS NULL OR expires_at > NOW())"
      );
      const latest = result.rows[0]?.latest;
      if (latest && (Date.now() - new Date(latest).getTime()) < 4 * 3600 * 1000) {
        console.log(`   GDELT: recent data exists, normal fetch`);
      } else {
        gdeltHours = 72;
        console.log(`   GDELT: ${latest ? 'stale data' : 'empty'}, backfilling 72h`);
      }
    }

    await fetchSources(SOURCES, src => (src.PREFIX === 'gdelt' && gdeltHours) ? [gdeltHours] : []);
    initialFetchDone = true;

    // Schedule fetches — group by cron to avoid duplicate timers
    const scheduleGroups = groupBySchedule(SOURCES);
    for (const [schedule, sources] of Object.entries(scheduleGroups)) {
      const names = sources.map(s => s.SOURCE_NAME).join('+');
      cron.schedule(schedule, async () => {
        console.log(`\n⏰ Scheduled: ${names}`);
        await fetchSources(sources);
      });
      console.log(`✓ Scheduled ${names} [${schedule}]`);
    }

    // Hourly cleanup of expired events
    cron.schedule('0 * * * *', async () => {
      try {
        const result = await pool.query(
          "DELETE FROM events WHERE expires_at IS NOT NULL AND expires_at < NOW()"
        );
        if (result.rowCount > 0) {
          console.log(`🧹 Cleanup: removed ${result.rowCount} expired events`);
        }
      } catch (e) {
        console.error('Cleanup failed:', e.message);
      }
    });
    console.log('✓ Scheduled hourly expiry cleanup');
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// Docker sends SIGTERM on stop; a terminal sends SIGINT. Same exit path.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down...`);
  setTimeout(() => process.exit(1), 8000).unref();
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    if (client.isOpen) await client.quit();
    await pool.end();
  } catch (e) {
    console.error('Shutdown error:', e.message);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
