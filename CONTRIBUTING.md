# Contributing to HazardPulse

Thanks for your interest in contributing. HazardPulse is a small, focused project — contributions that improve data quality, add data sources, or fix bugs are especially welcome.

## Development Setup

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ (for local development without Docker)
- Git

### Running Locally

**With Docker (recommended):**
```bash
git clone https://github.com/abontherun-lang/hazardpulse.git
cd hazardpulse
docker compose up -d
```
First startup takes ~3-5 minutes (downloads Census TIGER boundary data). Open http://localhost:3000.

**Without Docker (for faster iteration):**
```bash
# Start PostgreSQL + PostGIS (required)
docker run -d --name hazardpulse-db -p 5432:5432 \
  -e POSTGRES_USER=hazardpulse \
  -e POSTGRES_PASSWORD=hazardpulse \
  -e POSTGRES_DB=hazardpulse \
  postgis/postgis:16-3.4-alpine

# Start Redis (required for response cache)
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Install and run
cd backend
cp ../.env.example .env
npm install
DATABASE_URL=postgresql://hazardpulse:hazardpulse@localhost:5432/hazardpulse npm run dev
```
Frontend is served by Express from `../frontend/` — edit HTML/CSS/JS and refresh.

## Adding a New Data Source

This is the most common contribution. Each source is a single file in `backend/sources/`.

### Step-by-step

1. **Copy the template**: `cp backend/sources/usgs.js backend/sources/yoursource.js`

2. **Implement the interface** — every source exports:
   ```javascript
   module.exports = {
     fetch,          // async — fetch from API, store in PostGIS via storeEvent/storeEvents
     getActive,      // async — return getActiveEvents(SOURCE_NAME)
     SOURCE_NAME,    // string — display name (e.g. "NOAA Weather")
     CRON_SCHEDULE,  // string — cron expression (e.g. "*/15 * * * *")
     PREFIX,         // string — meta key in API response (e.g. "alert")
   };
   ```

3. **Use `storeEvent` or `storeEvents`** from `common.js`:
   ```javascript
   const { storeEvent, storeEvents, getActiveEvents, setLastUpdate } = require('./common');

   // Single event (NOAA, FEMA — lower volume, may have polygon geometry)
   await storeEvent(SOURCE_NAME, id, {
     event, category, severity, headline, description, areaDesc,
     color, sourceUrl, timestamp,
     lat, lon,           // for points
     // geometry,         // for polygons (GeoJSON object)
     // ...extras         // anything else goes into props JSONB
   }, ttlSeconds);

   // Batch (USGS, FIRMS, GDELT, dispatch — higher volume)
   await storeEvents(SOURCE_NAME, eventsArray, ttlSeconds);
   ```
   Reverse geocoding (state, county, city) and scanner link resolution happen automatically.

4. **Register it** in `backend/server.js`:
   ```javascript
   const SOURCES = [
     // ...existing sources
     require('./sources/yoursource'),
   ];
   ```

5. **Add the UI** — add a checkbox in `frontend/index.html` and the layer type in `frontend/app.js` `LAYER_GROUPS`.

6. **Verify** — check all items from the layer checklist:
   - Every checkbox `data-type` has a matching `DATA_TYPES` entry in app.js
   - Every `DATA_TYPES` entry has a checkbox in index.html
   - The backend feature's `source` property routes correctly in `buildLayers`
   - Features with `null` geometry don't crash the build loop
   - `/api/all` returns features with correct `source` values
   - Toggle on/off works for the new layer

### Adding a new dispatch city

No code changes needed. Add an entry to `backend/sources/dispatch-feeds.json`:

```json
{
  "id": "your_city_feed",
  "city": "City Name",
  "state": "ST",
  "platform": "socrata",
  "domain": "data.cityname.gov",
  "dataset": "xxxx-yyyy",
  "fields": { "type": "...", "lat": "...", "lon": "...", "time": "...", "id": "..." },
  "crisisTypes": ["..."],
  "categoryMap": { "...": "Dispatch Fire" },
  "hoursBack": 4
}
```

Supported platforms: `socrata` (Socrata SODA API) and `arcgis` (ArcGIS FeatureServer). To add a new platform, create an adapter in `backend/sources/adapters/`.

### Source requirements
- Must be a **free, public API** with no authentication (or free registration)
- Must provide **geographic data** (lat/lon or polygons)
- Must be **US-focused** or have US data
- Should **update at least daily**
- Must handle API failures gracefully (log and continue, don't crash)

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test with Docker: `docker compose build && docker compose up -d`
4. Verify the map loads and your changes work
5. Open a PR with a clear description of what and why

### PR checklist
- [ ] Docker builds and runs successfully
- [ ] No hardcoded API keys, emails, or personal info
- [ ] New data sources follow the module pattern in `backend/sources/`
- [ ] Layer checkboxes and toggles work (if UI was changed)
- [ ] No unrelated changes included

## Code Style

- Vanilla JavaScript (no TypeScript, no framework)
- 2-space indentation
- Single quotes for strings
- Use `const` by default, `let` when mutation is needed
- Keep source modules short — aim for under 200 lines
- Comments only where the logic isn't obvious

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser and OS (for frontend bugs)
- Docker logs if relevant (`docker compose logs`)

## Questions?

Open a GitHub Discussion or issue. There's no mailing list or chat server yet.
