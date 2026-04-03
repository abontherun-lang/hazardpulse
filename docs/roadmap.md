# HazardPulse Roadmap

What's been built, what's next, and the long-term vision.

---

## What's Done

Built from scratch to a fully functional multi-source crisis visualization platform:

- 6 live data sources (NOAA, USGS, NASA FIRMS, GDELT, FEMA IPAWS, 911 Dispatch)
- 911 dispatch feeds from 5 cities via config-driven platform adapters (Socrata, ArcGIS)
- ~2,000+ features with automatic refresh on cron schedules
- Modular backend — one file per source, consistent interface
- PostgreSQL + PostGIS persistent storage with normalized event schema
- Census TIGER/Line reverse geocoding (state, county, city on every event)
- Broadcastify scanner links resolved via DB join (27,302 channels)
- Redis response cache with ETag/304 support
- 7 collapsible layer groups with individual toggles
- Quick view presets (All, Weather, Seismic, Fire, Conflict, Critical)
- Time filter slider with server-provided bounds
- Zoom-based progressive disclosure
- Severity-based opacity
- NOAA alerts geocoded via bundled UGC zone centroids
- GDELT noise reduction (dropped unreliable CAMEO codes, multi-source filter)
- FEMA IPAWS alerts routed to appropriate layers
- Satellite/radar imagery overlays with opacity control
- Docker Compose deployment (app + PostGIS, one command)
- All free data sources, no API keys required

## Tier 1 — Before or Shortly After Public Release

- [x] Demo GIF in README
- [x] CONTRIBUTING.md
- [x] GitHub repo topics and badges
- [x] PostGIS migration — persistent storage, normalized schema, spatial queries
- [x] Census TIGER/Line reverse geocoding
- [x] Scanner links via DB join (replaced 511KB client-side JSON)
- [x] 911 dispatch feeds (5 cities)
- [ ] Fresh-machine test — clone to clean environment, `docker compose up -d`, verify

## Tier 2 — High Impact Features

- [ ] **NIFC wildfire incidents** — Official named fires with acreage, containment %, perimeter polygons. Free ArcGIS endpoint. Complements NASA FIRMS satellite hotspots. See [data-sources.md](data-sources.md).
- [ ] **More dispatch cities** — 34 confirmed working APIs. Add via `dispatch-feeds.json`. See [civil-incidents-research.md](civil-incidents-research.md).
- [ ] **Mobile responsiveness** — Legend panel, popups, and controls need testing/adjustment on phones and tablets.
- [ ] **GitHub Actions CI** — Docker build test on every push.

## Tier 3 — Growth Features

- [ ] **Spatial query API** — PostGIS enables radius search, bounding box, point-in-polygon queries.
- [ ] **Historical data** — Events persist in PostGIS. Add time-range queries and historical playback.
- [ ] **Notification/alert system** — WebSocket push or email when high-severity events appear nearby.
- [ ] **Power outage layer** — Kubra StormCenter integration. Research complete in [power-outages.md](power-outages.md).
- [ ] **ACLED integration** — Human-verified conflict data (free API key). Weekly updates, much higher accuracy than GDELT. See [gdelt-filtering.md](gdelt-filtering.md).
- [ ] **Air quality (AirNow/EPA)** — 6,500+ monitoring stations. See [data-sources-research.md](data-sources-research.md).
- [ ] **NOAA river gauges** — 12,600 flood gauges with real-time status.
- [ ] **Docker Hub image** — `docker pull hazardpulse/hazardpulse` for easier adoption.

## Long-Term Vision

- User accounts with saved locations and alert preferences
- Real-time WebSocket push (replace polling)
- PWA with offline map tile caching
- Embeddable widget for other sites
- Additional data sources (FAA delays, CDC disease surveillance, nuclear reactor status)
- Community contributions and self-hosted instances

## Research Completed

| Feature | Documentation | Status |
|---------|--------------|--------|
| Power outages (Kubra) | [power-outages.md](power-outages.md) | Verified working, 3 utilities tested |
| 20+ government APIs | [data-sources-research.md](data-sources-research.md) | Endpoints tested, priorities ranked |
| GDELT noise reduction | [gdelt-filtering.md](gdelt-filtering.md) | Approaches 1+4 implemented, 3+5 documented |
| 911/CAD dispatch data | [civil-incidents-research.md](civil-incidents-research.md) | 34 confirmed APIs, 5 cities live |
