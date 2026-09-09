# HazardPulse Roadmap

What's built, what's next.

---

## Done

- 10 polled sources: NOAA alerts, USGS earthquakes, NASA FIRMS, NIFC
  incidents, SPC preliminary tornado reports, NWS DAT damage surveys, USGS
  volcanoes, GDELT, FEMA IPAWS, 911 dispatch (4 cities via Socrata and
  ArcGIS adapters)
- PostgreSQL + PostGIS with a normalized event schema and TIGER/Line
  reverse geocoding on every event
- One alert policy for NOAA and FEMA (every warning except marine, an
  allow-list of watches and advisories, NWS-sent IPAWS messages skipped)
- One layer registry (`backend/layers.json`) driving backend colors, the
  generated legend, status counts and presets
- Broadcastify scanner links via DB join (27,302 channels)
- In-memory response cache with a content-hash ETag
- Time filter, zoom-based disclosure, severity opacity, quick-view presets
- Satellite and radar overlays, vendored Leaflet
- Mobile layout (icon-only header, locked viewport)
- Docker Compose deployment; CI runs the unit tests and a compose build on
  every PR and publishes an image to GHCR on merge
- Unit tests for every parser and policy, migrations for stored data

## Next

- [ ] **Fresh-machine test** — clone to a clean environment,
      `docker compose up -d`, verify.
- [ ] **More dispatch cities** — 34 confirmed working APIs; add via
      `dispatch-feeds.json`. Cincinnati was dropped 2026-09 (daily batch feed). See
      [civil-incidents-research.md](civil-incidents-research.md).
- [ ] **Express 5** — clears the last two `npm audit` moderates (qs).
- [ ] **NIFC perimeter polygons** — the incident layer is points only.
- [ ] **Pull the CI image on the server** — needs a read:packages token
      while the repo is private; the host builds from source today.

## Later

- Spatial query API (radius, bounding box) — PostGIS makes it cheap
- Historical playback from the persisted events
- Notifications (ntfy/WebSocket) when a high-severity event lands nearby
- Power outage layer — Kubra StormCenter, research in
  [power-outages.md](power-outages.md)
- ACLED as a verified conflict layer beside GDELT — see
  [gdelt-filtering.md](gdelt-filtering.md)
- Air quality (AirNow), NOAA river gauges — see
  [data-sources-research.md](data-sources-research.md)
- Real-time push instead of polling, PWA/offline tiles, embeddable widget

## Research completed

| Feature | Documentation | Status |
|---------|--------------|--------|
| Power outages (Kubra) | [power-outages.md](power-outages.md) | Verified working, 3 utilities tested |
| 20+ government APIs | [data-sources-research.md](data-sources-research.md) | Endpoints tested, priorities ranked |
| GDELT noise reduction | [gdelt-filtering.md](gdelt-filtering.md) | Approaches 1+4 implemented, 3+5 documented |
| 911/CAD dispatch data | [civil-incidents-research.md](civil-incidents-research.md) | 34 confirmed APIs, 4 cities live |
