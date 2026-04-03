# HazardPulse Architecture

System design and technical decisions for the HazardPulse crisis visualization platform.

---

## Architecture

HazardPulse runs as two Docker containers: an app server (Node.js + Redis cache) and a PostGIS database. Data flows from external APIs through source modules into a normalized PostGIS schema, then out to the browser as cached GeoJSON.

```
┌──────────────────────────────────────────────┐
│         App Container (Node.js + Redis)       │
│                                              │
│   ┌────────────────┐   ┌──────────────────┐  │
│   │  Redis          │   │  Node.js/Express │  │
│   │  - JSON cache   │◄──│  - REST API      │  │
│   │  - ETag store   │   │  - Cron scheduler│  │
│   │                 │   │  - Static files  │  │
│   └────────────────┘   └────────┬─────────┘  │
│                                  │            │
└──────────────────────────────────┼────────────┘
                                   │ :3000
                                   ▼
                            ┌─────────────┐
                            │  Browser    │
                            │  Leaflet map│
                            └─────────────┘

┌──────────────────────────────────────────────┐
│         DB Container (PostGIS)                │
│                                              │
│   events table ──── normalized crisis data   │
│   tiger_states ──── Census state boundaries  │
│   tiger_counties ── Census county boundaries │
│   tiger_places ──── Census city boundaries   │
│   scanners ──────── Broadcastify channel IDs │
│   state_fips ────── State FIPS codes         │
│   source_meta ───── Last update timestamps   │
│                                              │
└──────────────────────────────────────────────┘

              ┌──────────────────────────────┐
              │     External APIs (cron)      │
              │  NOAA · USGS · FIRMS · GDELT │
              │  FEMA · 911 Dispatch          │
              └──────────────────────────────┘
```

## Data Flow

1. **Cron triggers** fire per data source schedule (5-15 min depending on source)
2. **Source modules** fetch from external APIs, normalize data to a common shape
3. **`storeEvent()`** writes to PostGIS with automatic reverse geocoding via TIGER spatial join
4. **Scanner links** resolved at query time via DB join (county/city → Broadcastify channel ID)
5. **`rebuildCache()`** runs a single query across all sources, serializes to JSON, stores in Redis
6. **Frontend polls** `/api/all` every 5 minutes with ETag for 304 support
7. **Map rebuilds** layer groups from the GeoJSON FeatureCollection

## Database Schema

### `events` — normalized crisis data (all sources write here)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique event ID |
| `source` | TEXT | Source name (`NOAA`, `USGS`, `NASA FIRMS`, etc.) |
| `event` | TEXT | Event type label (e.g., `Tornado Warning`, `Earthquake`) |
| `category` | TEXT | UI layer bucket (e.g., `Dispatch Fire`, `Official Alerts`) |
| `severity` | TEXT | `Extreme` / `Severe` / `Moderate` / `Minor` / `Low` / `Micro` |
| `headline` | TEXT | Brief title |
| `description` | TEXT | Detailed text |
| `area_desc` | TEXT | Geographic description from source |
| `color` | TEXT | Hex color for rendering |
| `source_url` | TEXT | Link to original source |
| `event_time` | TIMESTAMPTZ | When the event happened |
| `expires_at` | TIMESTAMPTZ | When to stop showing (replaces Redis TTL) |
| `geom` | GEOMETRY(Geometry, 4326) | Point or Polygon — single column, GiST indexed |
| `props` | JSONB | Source-specific extras (mag, depth, frp, confidence, etc.) |
| `state_abbr` | TEXT | Reverse geocoded from TIGER (e.g., `IN`) |
| `state_name` | TEXT | Reverse geocoded, lowercase (e.g., `indiana`) |
| `county` | TEXT | Reverse geocoded, lowercase (e.g., `marion`) |
| `city` | TEXT | Reverse geocoded, lowercase (e.g., `indianapolis`) |

County/city stored lowercase to join directly with the `scanners` table — no per-query function calls.

### `scanners` — Broadcastify radio lookup (27,302 entries)

| Column | Type | Description |
|--------|------|-------------|
| `name` | TEXT | Lowercase place/county name |
| `state_abbr` | TEXT | 2-letter state abbreviation |
| `channel_id` | INTEGER | Broadcastify channel ID |

Primary key: `(name, state_abbr)`. Joined at query time: `scanners.name = events.county` and `scanners.name = events.city`.

### Reference tables

- **`tiger_states`** / **`tiger_counties`** / **`tiger_places`** — Census TIGER/Line boundary polygons with GiST spatial indexes. Used for reverse geocoding at ingest time via `ST_Intersects`.
- **`state_fips`** — State abbreviation → FIPS code. Used for state-level scanner fallback links.
- **`source_meta`** — Last update timestamp and count per source.

## File Structure

```
hazardpulse/
  docker-compose.yml         App + PostGIS containers
  Dockerfile                 Node.js + Redis (response cache)
  start.sh                   Container entrypoint (starts Redis, then Node)
  .env.example               Environment variable template
  backend/
    server.js                Express API + cron scheduling + cache rebuild
    db.js                    PostgreSQL connection pool + schema init
    schema.sql               DDL for events, scanners, source_meta, state_fips
    redis-client.js          Redis connection (response cache only)
    ugc_centroids.json       NOAA zone → lat/lon lookup (7,880 zones)
    scripts/
      load-tiger.sh          Downloads Census TIGER boundary data into PostGIS
      load-scanners.js       Imports Broadcastify scanner data into PostGIS
    sources/                 One module per data source
      common.js              Storage + query layer (storeEvent, getAllActiveEvents)
      noaa.js                NOAA weather alerts
      usgs.js                USGS earthquakes
      firms.js               NASA FIRMS wildfires
      gdelt.js               GDELT conflict/unrest
      fema.js                FEMA IPAWS emergency alerts
      dispatch.js            911 dispatch aggregator
      dispatch-feeds.json    Feed configs for dispatch cities
      adapters/              Platform-specific API adapters
        socrata.js           Socrata SODA API
        arcgis.js            ArcGIS FeatureServer
  frontend/
    index.html               Map UI + layer control panel
    app.js                   Leaflet map + data rendering
    styles.css               Cyberpunk-themed UI
    scanner_lookup.json      Source data for scanner DB import
```

## Technology Choices

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js 20 + Express | JavaScript full-stack, async I/O, huge ecosystem |
| **Database** | PostgreSQL 16 + PostGIS 3.4 | Gold standard for geospatial — spatial indexes, geometry types, 1000+ spatial functions |
| **Cache** | Redis 7 (in-container) | Fast in-memory response cache, ETag storage |
| **Geocoding** | Census TIGER/Line | Free, authoritative US boundaries, no API calls, no rate limits |
| **Map** | Leaflet 1.9 | Free, lightweight (38KB), no API key, plugin ecosystem |
| **Tiles** | OpenStreetMap | Completely free, no API key, community-maintained |
| **Satellite** | Iowa State Mesonet | Free GOES-East tiles (IR, visible, water vapor) |
| **Radar** | RainViewer | Free tier precipitation radar |
| **Deployment** | Docker + Docker Compose | Two containers, one command, reproducible |
| **Frontend** | Vanilla JS + CSS | No build step, instant iteration, ~800 lines total |

## Source Module Interface

Every data source is a single file in `backend/sources/` exporting:

```javascript
module.exports = {
  fetch,          // async (hoursBack?) — fetch from API, normalize, store in PostGIS
  getActive,      // async () — return GeoJSON FeatureCollection from PostGIS
  SOURCE_NAME,    // string — display name (e.g. "NOAA")
  CRON_SCHEDULE,  // string — cron expression (e.g. "*/15 * * * *")
  PREFIX,         // string — meta key in API response (e.g. "alert", "quake")
};
```

Shared utilities in `common.js`:
- `storeEvent(source, id, data, ttl)` — upsert a single event into PostGIS with TIGER reverse geocoding
- `storeEvents(source, events, ttl)` — batch upsert in a single transaction (for high-volume sources)
- `getActiveEvents(source)` — single query returning GeoJSON FeatureCollection for one source
- `getAllActiveEvents(sources)` — single query for all sources with scanner JOINs and time bounds
- `sanitize(str)` / `sanitizeUrl(str)` — HTML entity encoding for stored data
- `isInUS(lat, lon)` — bounding box check (continental, AK, HI, PR, Guam)

## Caching Strategy

- **PostGIS** is the persistent store — all events with `expires_at` column
- **Redis** is a thin response cache — pre-built JSON string for `/api/all`, rebuilt after each fetch cycle
- **In-memory** fallback — `cachedResponse` variable for fastest path
- **Client-side** — ETag/If-None-Match for 304 responses, `Cache-Control: public, max-age=60`
- **Compression** — gzip via Express compression middleware
- **Expiry** — hourly cron job deletes events past `expires_at`; queries always filter `WHERE expires_at > NOW()`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/all` | All active features as GeoJSON FeatureCollection (served from cache) |
| GET | `/api/health` | Health check (PostgreSQL + Redis status, source list, cache size) |
| POST | `/api/fetch` | Manual refresh trigger (rate limited: 1/min) |

The `/api/all` response includes:
- `features[]` — GeoJSON features with scanner URLs pre-resolved
- `meta.{prefix}` — per-source count and last update time
- `meta.timeBounds` — `{min, max}` timestamps for the UI time slider

## Security

- Rate limiting on all `/api/` routes (60 req/min) and `/api/fetch` (1 req/min)
- XSS sanitization at two layers: backend `sanitize()` on stored data, frontend `esc()` on all popup template literals
- CORS configurable via `ALLOWED_ORIGINS` environment variable
- No authentication required (read-only public data)
- No API keys stored — all data sources are free and keyless
- PostgreSQL credentials are internal to the Docker network (not exposed to host)

## Performance

- **Spatial indexes** — GiST on event geometry and all TIGER tables for fast reverse geocoding
- **Scanner JOINs** — direct equality on normalized lowercase columns, no per-row functions
- **Single query cache rebuild** — one SQL query returns all active events with scanner data
- **Zoom-based filtering** — at low zoom, minor events hidden to reduce marker count
- **Canvas renderer** — Leaflet `preferCanvas: true` for better performance with many markers
- **Zoom bucket rebuild** — map only rebuilds layers when crossing zoom thresholds (4, 6, 8)
- **Batch inserts** — high-volume sources (FIRMS, GDELT, dispatch) use `storeEvents()` in a single transaction
- **Target** — <2s map load, <200ms API response, supports 100+ concurrent users
