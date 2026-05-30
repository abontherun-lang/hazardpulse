# HazardPulse Data Sources

All data sources used by HazardPulse, plus researched sources ready for future integration.

---

## Active Sources

These are currently integrated and running in production. All sources write to a normalized PostGIS `events` table via `storeEvent()` / `storeEvents()` in `common.js`. Reverse geocoding (state, county, city) is automatic via TIGER/Line spatial join at ingest.

### NOAA National Weather Service
- **Data**: Severe weather alerts (tornado, thunderstorm, flood, winter, wind, hurricane, tropical storm, storm surge, tsunami)
- **Endpoint**: `https://api.weather.gov/alerts/active`
- **Format**: GeoJSON (polygons and points)
- **Auth**: None (User-Agent with contact info recommended)
- **Update**: Every 15 minutes
- **Expiry**: Dynamic (based on alert expiry time, minimum 1 hour)
- **Notes**: Geometry can be polygon or point. Some alerts have no geometry — we geocode those via bundled UGC zone centroids (7,880 zones). Severity levels: Extreme > Severe > Moderate > Minor.

### USGS Earthquake Hazards Program
- **Data**: Earthquake detections with magnitude, depth, and location
- **Endpoint**: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`
- **Format**: GeoJSON (points)
- **Auth**: None
- **Update**: Every 5 minutes
- **Expiry**: 24 hours
- **Props**: `mag`, `depth` (stored in JSONB)
- **Notes**: Filtered to US bounding box. We filter by zoom level — small quakes hidden at low zoom.

### NASA FIRMS (Fire Information for Resource Management System)
- **Data**: Satellite *thermal anomaly* detections from the Suomi-NPP VIIRS sensor
- **Endpoint**: Direct CSV download (US contiguous + Hawaii, last 24h)
- **Format**: CSV (parsed to GeoJSON)
- **Auth**: None (direct download, no API key)
- **Update**: Every 3 hours
- **Expiry**: 24 hours
- **Props**: `frp`, `confidence`, `basis` (stored in JSONB)
- **False-positive gate** (`firms.js`): VIIRS reports thermal anomalies, not wildfires — the raw feed is dominated by persistent industrial sources (steel mills, refineries, gas flares), agricultural burns, volcanoes, and foreign hits that leak through the bounding box. Each deduped (0.01°) detection passes only if:
  1. it is **not** within `VOLCANO_SUPPRESS_KM` (20 km) of an elevated USGS volcano — those are represented on the Volcano layer; **and**
  2. its **FRP ≥ `FIRE_AUTOADMIT_FRP`** (50 MW — unmistakably a fire), **or** it falls within a **size-scaled radius of an active NIFC incident** (`FIRE_CORROBORATE_GEOREF_KM` base + the fire's equal-area radius, capped at `FIRE_CORROBORATE_MAX_KM`). The radius scales with acreage so a sub-acre brush fire can't validate an industrial hotspot kilometres away.
  After store, a TIGER state-polygon prune (`deleteWhereNoUSState`) drops anything that didn't land in a US state (precise border vs. the coarse bounding box). On today's feed this takes ~930 raw US detections down to ~30 high-confidence markers. All gate parameters are env-overridable (see `.env.example`).

### NIFC / WFIGS (National Interagency Fire Center)
- **Data**: Current interagency wildland fire incident locations — named fires with acreage, % containment, cause
- **Endpoint**: `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query` (`f=geojson`)
- **Format**: GeoJSON (points)
- **Auth**: None
- **Update**: Hourly
- **Expiry**: 6 hours
- **Props**: `acres`, `contained`, `cause` (stored in JSONB)
- **Notes**: Filtered to `IncidentTypeCategory='WF'` (prescribed burns excluded), not declared out, and either uncontained or discovered within 21 days. Rendered as the **Wildfire Incident** type (sized by acreage) and exported via `getActiveFirePoints()` to corroborate NASA FIRMS. Uses batch `storeEvents()`.

### USGS Volcano Hazards Program
- **Data**: US volcanoes at elevated alert (above NORMAL/GREEN) with alert level + aviation color code
- **Endpoint**: `https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson`
- **Format**: GeoJSON (points; carries `alertLevel` / `colorCode`)
- **Auth**: None
- **Update**: Hourly
- **Expiry**: 2 hours
- **Props**: `alertLevel`, `colorCode`, `observatory` (stored in JSONB)
- **Notes**: One call returns all US volcanoes with coordinates + current alert. Rendered as the **Volcano** type (color = aviation code) and exported via `getElevatedPoints()` so FIRMS attributes volcanic thermal anomalies here instead of mislabeling them as wildfires. Covers Alaska (not in the FIRMS feed) as a bonus.

### GDELT Project
- **Data**: News-derived conflict and unrest events (protests, armed violence, use of force)
- **Endpoint**: `http://data.gdeltproject.org/gdeltv2/` (15-min CSV exports in ZIP files)
- **Format**: Tab-delimited CSV
- **Auth**: None (public domain)
- **Update**: Every 15 minutes
- **Expiry**: 72 hours
- **Notes**: NLP-classified using CAMEO event codes. Noise reduction applied — see [gdelt-filtering.md](gdelt-filtering.md). Requires NumArticles >= 3 for multi-source confirmation. Unreliable CAMEO codes dropped (bombing, suicide attack, WMD). Uses batch `storeEvents()`.

### FEMA IPAWS (Integrated Public Alert and Warning System)
- **Data**: Emergency alerts from 1,500+ agencies — evacuations, law enforcement warnings, AMBER alerts, missing persons, civil emergencies
- **Endpoint**: `https://www.fema.gov/api/open/v1/IpawsArchivedAlerts`
- **Format**: JSON with CAP (Common Alerting Protocol) XML
- **Auth**: None
- **Update**: Every 15 minutes
- **Expiry**: 6 hours
- **Props**: `urgency`, `femaEvent`, `instruction`, `senderName` (stored in JSONB)
- **Notes**: Alerts routed to appropriate UI layers (emergency alerts, missing persons, wildfire). Contains polygon/circle geometry or FIPS county codes. Weather duplicates skipped (NOAA covers those).

### 911 Dispatch
- **Data**: Municipal CAD/dispatch feeds — fires, violence, accidents, hazmat
- **Platforms**: Socrata SODA API, ArcGIS FeatureServer
- **Auth**: None
- **Update**: Every 10 minutes
- **Expiry**: 4 hours
- **Props**: `city`, `dispatchType` (stored in JSONB)
- **Cities**: Seattle WA, San Francisco CA, Austin TX, Cincinnati OH, Indianapolis IN
- **Notes**: Config-driven via `dispatch-feeds.json`. Platform adapters in `adapters/socrata.js` and `adapters/arcgis.js`. To add a city, add an entry to the JSON config. Uses batch `storeEvents()`.

### Iowa State Mesonet (Satellite Imagery)
- **Data**: GOES-East satellite imagery tiles (infrared, visible, water vapor)
- **Tiles**: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-{product}-{resolution}-900913/{z}/{x}/{y}.png`
- **Auth**: None
- **Update**: On demand (tile server)
- **Notes**: Free academic service. Max zoom 10. Products: `ir-4km`, `vis-1km`, `wv-4km`. Frontend-only (not stored in PostGIS).

### RainViewer (Precipitation Radar)
- **Data**: Composite precipitation radar
- **API**: `https://api.rainviewer.com/public/weather-maps.json`
- **Auth**: None
- **Update**: On demand
- **Notes**: Free tier for personal and educational use. Frontend-only (not stored in PostGIS).

---

## Researched Sources (Ready to Implement)

All endpoints verified working as of 2026-03-29. Organized by priority.

### Tier 1 — High Value

| Source | Data | Format | Key? | Frequency | Geographic |
|--------|------|--------|------|-----------|-----------|
| NIFC Wildfire Perimeters | Fire boundary polygons | GeoJSON | No | Daily | Polygon |
| FAA Airport Status | Ground delays, closures | XML | No | Minutes | Airport code |
| NOAA River Gauges | 12,600 flood gauges with status | JSON | No | 15 min | Lat/lon |
| FEMA Disaster Declarations | Federally declared disasters | JSON | No | Hours | FIPS county |
| CDC Syndromic Surveillance | COVID/flu/RSV ER visits by county | JSON | No | Weekly | FIPS county |

### Tier 2 — Good Value

| Source | Data | Format | Key? | Notes |
|--------|------|--------|------|-------|
| AirNow (bulk) | AQI for 6,500+ stations | Pipe-delimited | No | Hourly, needs custom parser |
| NRC Reactor Status | Daily power % for 93 US reactors | Pipe-delimited | No | Needs lat/lon lookup table |
| USGS STN Flood Events | Post-flood high water marks | JSON | No | Event-based, not real-time |
| CDC NNDSS | Notifiable disease counts | JSON | No | Weekly, state-level |

### Sources That Don't Work

| Source | Why |
|--------|-----|
| PowerOutage.us | Behind Cloudflare, paid API only |
| DOE Eagle-I | Requires government credentials |
| DHS Threat Levels | No structured API (web pages only) |
| FBI/ATF Active Shooter | No public feed |
| Coast Guard Maritime | No public API |
| National Dam Inventory | API broken |
| InciWeb | Superseded by NIFC ArcGIS services |

---

## API Compliance

| Source | Requirement | Our Implementation |
|--------|------------|-------------------|
| NOAA | User-Agent with contact info | Configurable via `USER_AGENT` env var |
| USGS | Cache aggressively | 5-min poll, 24h expiry |
| NASA FIRMS | No more than 1 req/sec | 3-hour poll cycle |
| GDELT | Public domain, no restrictions | 15-min poll |
| FEMA | No restrictions documented | 15-min poll |
| Dispatch | Per-city open data policies | 10-min poll, crisis types only |
| IEM | Free for educational/personal use | On-demand tiles only |
| RainViewer | Free for personal/educational use | On-demand tiles |

For detailed endpoint URLs, query parameters, and response schemas for the researched sources, see [data-sources-research.md](data-sources-research.md).
