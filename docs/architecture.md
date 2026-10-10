# HazardPulse Architecture

System design and technical decisions. Kept to what the code does today; the
git log has the history.

---

## Architecture

Two Docker containers: an app server (Node.js) and a PostGIS database. Data
flows from external APIs through source modules into a normalized PostGIS
schema, then out to the browser as one cached GeoJSON document.

```
┌──────────────────────────────────────────────┐
│           App Container (Node.js)            │
│                                              │
│   Express: REST API + static frontend        │
│   node-cron: per-source fetch schedules      │
│   In-memory JSON cache of /api/all (+ETag)   │
│                                              │
└──────────────────────┬───────────────────────┘
                       │ :3000
                       ▼
                ┌─────────────┐
                │  Browser    │
                │  Leaflet map│
                └─────────────┘

┌──────────────────────────────────────────────┐
│         DB Container (PostGIS)               │
│                                              │
│   events ────────── normalized hazard data   │
│   tiger_states ──── Census state boundaries  │
│   tiger_counties ── Census county boundaries │
│   tiger_places ──── Census city boundaries   │
│   scanners ──────── Broadcastify channel IDs │
│   state_fips ────── State FIPS codes         │
│   source_meta ───── Last update per source   │
│   app_meta ──────── Migrations that have run │
└──────────────────────────────────────────────┘

              ┌────────────────────────────────────┐
              │        External APIs (cron)        │
              │ NOAA · USGS · FIRMS · NIFC · SPC   │
              │ DAT · Volcano · GDELT · FEMA · 911 │
              └────────────────────────────────────┘
```

## Startup order

`server.js` `start()`:

1. Connect to PostGIS, apply `schema.sql` (idempotent), run any pending
   migration from `migrations.js` (recorded in `app_meta`), load TIGER
   boundaries and scanner data on first boot.
2. Rebuild the response cache from whatever PostGIS already holds.
3. **Listen.** A restart serves a stale map, never a blank one.
4. Resolve the home-base location (env or IP geolocation).
5. Initial fetch in two waves: every source, then the sources that read
   other sources' rows (`AFTER`, currently FIRMS after NIFC and volcano).
6. Schedule cron groups and the hourly expiry cleanup.

`/api/health` is 200 once Postgres answers (`status: "starting"` until the
initial fetch completes, `"healthy"` after) and 503 when it does not; that is
what the Docker healthcheck and the deploy script watch. SIGTERM and SIGINT
close the server and the pool.

## Data flow

1. **Cron triggers** fire per source (5 min to 3 h).
2. **Source modules** fetch, normalize to the common event shape, and call
   `storeEvent()` (one row, polygon-capable) or `storeEvents()` (batch:
   one `INSERT … SELECT FROM unnest()` per 1000 rows, then one geocoding
   `UPDATE`, in a transaction).
3. **Reverse geocoding** at ingest: state, county and city via TIGER
   spatial joins; polygons and lines use their centroid.
4. **`rebuildCache()`** runs `getAllActiveEvents()` — one query with the
   scanner joins and the display window — and serializes the
   FeatureCollection. The ETag is a sha1 of the body.
5. **Frontend** loads `/api/layers` once, then polls `/api/all` every five
   minutes with `If-None-Match`; an unchanged map is a 304.

## Source module interface

Every data source is a file in `backend/sources/` exporting:

```javascript
module.exports = {
  fetch,          // async (hoursBack?) — fetch from the API, normalize, store
  SOURCE_NAME,    // string — the events.source value (e.g. "NOAA")
  CRON_SCHEDULE,  // string — cron expression (e.g. "*/15 * * * *")
  PREFIX,         // string — meta key in /api/all (e.g. "alert")
  AFTER,          // optional string[] — sources whose rows this one reads
};
```

Register it in `SOURCES` in `server.js` and register every `category` it
writes in `backend/layers.json`. Shared pieces:

- `common.js` — `text()` (plain text, no escaping), `storeEvent`,
  `storeEvents` / `buildBatchRows`, `getAllActiveEvents`, `getActivePoints`,
  `deleteWhereNoUSState`, `isInUS`, `haversineKm`, `TTL`,
  `cronIntervalMinutes`.
- `http.js` — the one axios instance (User-Agent with contact info,
  timeout, gzip, size cap).
- `layers.js` / `layers.json` — the layer registry: `colorOf(type)` for the
  backend, `GET /api/layers` for the browser.
- `alert-policy.js` — which NWS alerts are shown; used by NOAA and FEMA.
- `geo.js` — FIPS tables, state centroids, SAME code → point.

Text is stored raw. The frontend's `esc()` is the only place it is escaped.

## Sources

| Module | Source | Schedule | Notes |
|---|---|---|---|
| `noaa.js` | NWS alerts API | 15 min | Filtered by `alert-policy.js`; geometry from the API, else TIGER county union, else centroid |
| `usgs.js` | USGS earthquakes (24 h feed) | 5 min | US bounding box |
| `firms.js` | NASA FIRMS VIIRS (CSV) | 3 h | Intensity or NIFC corroboration gate, volcano suppression, TIGER prune; `AFTER: NIFC, USGS Volcano` |
| `nifc.js` | NIFC/WFIGS incidents (ArcGIS) | hourly :15 | Active wildland fires, sized by acreage |
| `spc.js` | SPC tornado reports (ArcGIS) | 15 min | Preliminary local storm reports, unrated; id = time + place |
| `dat.js` | NWS Damage Assessment Toolkit (ArcGIS) | hourly :30 | Surveyed tornado tracks with EF rating; storm date within 14 days |
| `nhc.js` | NHC CurrentStorms index + NHC_tropical_weather ArcGIS (GeoJSON) | 15 min | Storm center, forecast points/track/cone, advisory wind field; products checked against the storm id |
| `volcano.js` | USGS Volcano Hazards | hourly | Elevated alert levels only |
| `gdelt.js` | GDELT v2 exports (15-min zips) | 15 min | CAMEO filter, NumArticles ≥ 3, country code, TIGER prune |
| `fema.js` | FEMA IPAWS archive | 15 min | NWS-sent messages skipped; local authorities kept |
| `dispatch.js` | City CAD feeds (`dispatch-feeds.json`) | 10 min | Socrata and ArcGIS adapters; warns after three empty cycles |

Full endpoint details: [data-sources.md](data-sources.md).

## Database schema

### `events` — normalized hazard data (all sources write here)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique event ID (source-prefixed) |
| `source` | TEXT | `SOURCE_NAME` |
| `event` | TEXT | What the source calls it (e.g. `Tornado Warning`, `STRUCTURE FIRE`) |
| `category` | TEXT | Layer type from `layers.json` — the legend row it toggles |
| `severity` | TEXT | `Extreme` / `Severe` / `Moderate` / `Minor` / `Low` / `Micro` / `Unknown` |
| `headline`, `description`, `area_desc` | TEXT | Plain text, unescaped |
| `color` | TEXT | Hex color for rendering |
| `source_url` | TEXT | Link to the original |
| `event_time` | TIMESTAMPTZ | When it happened (or was published, for ongoing incidents) |
| `expires_at` | TIMESTAMPTZ | When to stop showing |
| `geom` | GEOMETRY(Geometry, 4326) | Point, LineString or (Multi)Polygon — GiST indexed |
| `props` | JSONB | Source-specific extras |
| `state_abbr`, `state_name`, `county`, `city` | TEXT | Reverse geocoded at ingest, lowercase |

### Reference tables

- **`tiger_states` / `tiger_counties` / `tiger_places`** — Census TIGER/Line
  polygons, loaded on first boot by `scripts/load-tiger.sh`.
- **`scanners`** — Broadcastify channel IDs by lowercase place name + state
  (27,302 rows from `data/scanner_lookup.json`); **`state_fips`** for the
  state-level fallback link.
- **`source_meta`** — last update time and count per source.
- **`app_meta`** — keys of migrations that have run.

Schema changes are `CREATE … IF NOT EXISTS` in `schema.sql`; data changes
are one-shot entries in `migrations.js`.

## Display window and expiry

Each source sets a TTL (`expires_at`); an hourly job deletes expired rows.
On top of that the API only serves rows whose `event_time` is within
`DISPLAY_WINDOW_HOURS` (default 72). Ongoing incidents (NIFC fires,
volcanoes) stamp `event_time` at ingest so they stay visible; damage
surveys stamp their publish time.

## Frontend

Vanilla JS + Leaflet (vendored under `frontend/vendor/`). On boot it fetches
`/api/layers`, builds the layer groups, colors, presets and the legend from
it, then loads `/api/all`. Markers are drawn on a canvas; clustered types
use Leaflet.markercluster. A legend row can cover several event types (one
checkbox), so presets are lists of row ids or of whole groups; status counts
are per row for what is on screen. Radar tiles
come from RainViewer and satellite tiles from Iowa State Mesonet, both
fetched off the boot path.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/all` | All active features as a GeoJSON FeatureCollection; `meta.{prefix}` per source (count, lastUpdate, refreshMinutes), `meta.timeBounds` |
| GET | `/api/layers` | The layer registry |
| GET | `/api/health` | 200 / 503; Postgres state, initial-fetch state, cache size |
| GET | `/api/location` | Home-base pin (env or IP geolocation) with a scanner link |
| GET | `/api/weather` | Local conditions and forecast (wttr.in, cached 30 min) |
| POST | `/api/fetch` | Manual refresh of every source; one per minute for the whole server |

## Security

- Rate limiting on `/api/` (60 req/min per IP) and a single global token per
  minute on `/api/fetch`, so no client can amplify upstream traffic.
- Text is escaped once, in the browser. Colors from the API are validated
  before they reach a style attribute.
- CORS configurable via `ALLOWED_ORIGINS`.
- No authentication (read-only public data), no API keys, database
  credentials internal to the compose network.
- `/api/location` exposes the configured home coordinates to anyone who can
  open the map — see the README before exposing an instance publicly.

## Technology choices

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 24 + Express 4 | Async I/O, small surface |
| Database | PostgreSQL 16 + PostGIS 3.4 | Spatial joins for geocoding, geometry storage |
| Geocoding | Census TIGER/Line | Free, authoritative, offline after first load |
| Map | Leaflet 1.9 (vendored) | Light, no key, no build step |
| Tiles | OpenStreetMap | Free |
| Deployment | Docker Compose | Two containers, one command |
| Frontend | Vanilla JS + CSS | No build step |
