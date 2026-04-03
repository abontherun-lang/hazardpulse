# Civil Incidents / 911 CAD Data — Research Notes

**Date**: 2026-03-31
**Status**: Researched, not yet implemented
**Goal**: Better source for civil incidents than GDELT (which is good for protests but noisy for everything else)

---

## Design Philosophy

HazardPulse is a **situational awareness tool** — the value is signal over noise on a single screen. Dispatch data should only surface incidents that matter at a crisis/hazard level: structure fires, shootings, major accidents, hazmat, active threats. NOT welfare checks, parking violations, noise complaints, or routine medical calls.

This is the same philosophy behind the GDELT noise reduction, zoom-based filtering, and severity opacity already in the app.

---

## Scale Assessment

- **555 US cities** have population >70,000 (2024 Census)
- **~34 have confirmed working API feeds** (~6% coverage)
- **~8 offer real-time data** (updated within 10 min)
- **~22 offer daily updates** (acceptable for a crisis map)
- **Socrata is the dominant platform** (~60% of usable feeds)
- **ArcGIS FeatureServer** is second (~20%)

### Data Volume Impact

| Scenario | New Features | Total w/ Existing 2K | Can Current App Handle? |
|----------|-------------|---------------------|----------------------|
| 6 real-time cities, crisis-only, 2hr window | ~200-500 | ~2,500 | Yes, easily |
| 15 cities, crisis-only, 4hr window | ~500-1,500 | ~3,500 | Yes |
| 30 cities, all types, 24hr window | ~30,000-50,000 | ~52,000 | No — needs clustering + API pagination |

**Recommended sweet spot**: Crisis-only filter + 2-4 hour TTL. Keeps dispatch at ~500-1,500 features.

---

## Co-Dependency: Marker Clustering

**Dispatch and clustering should ship together.** They're two halves of the same change.

**Why they need each other:**
- Dispatch features concentrate in cities — SF alone could have 50+ markers stacked on each other. Without clustering, dense cities become unusable.
- Without dispatch, clustering has less to demonstrate — the current 2,000 features are spread across the US and rarely overlap badly.
- Both touch the same frontend code (`buildLayers`, layer group initialization). Building them together means one pass through that code, not two.

**Clustering implementation (contained change, frontend only):**
1. Add `Leaflet.markercluster` from CDN (like Leaflet itself — no build step)
2. Each layer group becomes `L.markerClusterGroup()` instead of `L.layerGroup()`
3. Cluster icon color reflects the most severe item inside it
4. Clusters expand on click/zoom — standard markercluster behavior
5. Backend doesn't change at all

**Risk without clustering:** At 3,000-5,000 features (current 2K + dispatch), dense city areas will have overlapping markers that can't be clicked or distinguished. The canvas renderer handles the draw performance fine, but the UX breaks down. Clustering solves this cleanly.

---

## Architecture: Config-Driven Platform Adapters

```
dispatch-feeds.json (config per city)
       |
Platform Adapters (socrata.js, arcgis.js, csv.js)
       |
dispatch.js (single source module — normalizes to GeoJSON)
       |
existing pipeline (Redis → /api/all → map)
```

- **Adding a new city** = one JSON config entry
- **Adding a new platform** (e.g. ArcGIS) = one adapter file
- **dispatch.js** is the single source module registered in server.js — it iterates the config, calls the right adapter, normalizes everything to the standard feature format

### Example Config Entry

```json
{
  "seattle_fire": {
    "city": "Seattle, WA",
    "platform": "socrata",
    "domain": "data.seattle.gov",
    "dataset": "kzjm-xkqj",
    "fields": {
      "type": "type",
      "lat": "latitude",
      "lon": "longitude",
      "time": "datetime",
      "address": "address",
      "id": "incident_number"
    },
    "crisisTypes": [
      "Brush Fire", "Encampment Fire", "RV Fire", "Rubbish Fire",
      "MVI - Motor Vehicle Incident", "MVI Freeway",
      "Water Rescue Response", "Fuel Spill", "Natural Gas Odor",
      "Scenes Of Violence Aid", "Medic Response- Overdose"
    ],
    "priorityFilter": null,
    "hoursBack": 4
  }
}
```

### Three Adapters Cover ~90% of Feeds

1. **Socrata** (~20 cities) — SODA API client, `$where` server-side filtering
2. **ArcGIS FeatureServer** (~8 cities) — REST query with `where` clause
3. **CSV download** (~4 cities) — Phoenix, San Diego, San Jose

---

## Filtering: Crisis-Only is Feasible

### Server-Side Filtering (Best Case)

All Socrata endpoints support `$where` clauses. We can filter BEFORE downloading:

**By priority (where available):**
- San Francisco: `$where=priority_final='A'` (highest severity)
- Dallas: `$where=priority IN ('1','2')` (top 2 priority tiers)

**By type whitelist (where no priority field):**
- Seattle: `$where=type IN ('Brush Fire','MVI - Motor Vehicle Incident','Scenes Of Violence Aid',...)`
- Austin: `$where=issue_reported IN ('ATTACK - Active Attack','BOX -Structure Fire',...)`

### Two-Tier Filter Strategy

1. **Where priority exists**: Filter by priority first (catches types you might not anticipate)
2. **Where only type strings exist**: Maintain a whitelist of crisis-level types per city in the config

### Priority/Severity Field Availability

| City | Has Priority? | Values | Best Filter |
|------|--------------|--------|-------------|
| San Francisco | **YES** | A, B, C | `priority_final='A'` |
| Dallas | **YES** | 1, 2, 3, 4 | `priority IN ('1','2')` |
| Seattle Fire | No | — | Type whitelist |
| Austin Fire | No | — | Type whitelist |
| Nashville | DEAD | — | Migrated to ArcGIS, needs new endpoint |

---

## Confirmed Working Feeds

### Real-Time (updated every 5-10 min)

| City | Pop | Endpoint | Type Field | Priority Field |
|------|-----|----------|-----------|---------------|
| Seattle, WA | 779K | `data.seattle.gov` / `kzjm-xkqj` | `type` (44 types) | None |
| San Francisco, CA | 884K | `data.sfgov.org` / `gnap-fj3t` | `call_type_original_desc` (63 types) | `priority_final` (A/B/C) |
| Dallas, TX | 1,357K | `dallasopendata.com` / `9fxf-t2tr` | `nature_of_call` | `priority` (1-4) |
| Austin, TX | 1,018K | `datahub.austintexas.gov` / `wpu4-x69d` | `issue_reported` (26 types) | None |
| Milwaukee, WI | 560K | `itmdapps.milwaukee.gov/MPDCallData/` | Custom HTML/JSON | Unknown |
| Everett, WA | 113K | `data.everettwa.gov` / `w35j-83t3` | Similar to Seattle | Unknown |

### Daily Updates (good enough for crisis map)

| City | Pop | Endpoint | Notes |
|------|-----|----------|-------|
| Los Angeles, CA | 3,879K | `data.lacity.org` / `xjgu-z4ju` | LAPD Calls for Service |
| New York City, NY | 8,478K | `data.cityofnewyork.us` / `n2zq-pubd` | NYPD CFS (batch updates) |
| Montgomery Co, MD | 1,063K | `data.montgomerycountymd.gov` / `98cc-bc7d` | Police dispatch, 4x daily |
| Cincinnati, OH | 311K | `data.cincinnati-oh.gov` / `gexm-h6bt` (police) / `vnsz-a3wp` (fire) | Separate police + fire |
| New Orleans, LA | 384K | `data.nola.gov` / `es9j-6y5d` | Police CFS |
| Baton Rouge, LA | 224K | `data.brla.gov` / `dakq-4sda` | Fire incidents |
| Mesa, AZ | 518K | `citydata.mesaaz.gov` | Fire/medical + police |
| Baltimore, MD | 575K | ArcGIS Hub | 911 calls |
| Detroit, MI | 632K | ArcGIS Hub | 911 calls |
| Charlotte, NC | 923K | ArcGIS Hub | Police CFS |
| Sacramento, CA | 538K | ArcGIS Hub | Fire 911 |
| Nashville, TN | 687K | **DEAD** — migrated from Socrata to ArcGIS | Needs new endpoint |

### CSV-Only (need download adapter)

| City | Pop | Notes |
|------|-----|-------|
| Phoenix, AZ | 1,673K | CKAN portal, daily CSV |
| San Diego, CA | 1,407K | Daily CSV download |
| San Jose, CA | 1,038K | Quarterly CSV |

---

## Crisis-Level Call Types by City

### Seattle Fire 911 — Crisis Whitelist (14 of 44 types)
```
Brush Fire, Brush Fire Freeway, Encampment Fire, RV Fire, Rubbish Fire,
MVI - Motor Vehicle Incident, MVI Freeway,
Water Rescue Response, Fuel Spill, Natural Gas Odor,
Scenes Of Violence Aid, Medic Response- Overdose,
1RED 1 Unit, 2RED - 1 + 1, 3RED - 1 +1 + 1
```

### San Francisco Police — Priority A catches crisis-level
Or type whitelist:
```
AGG ASSAULT / ADW, STABBING, PERSON W/GUN, PERSON W/KNIFE,
SHOT SPOTTER, FIRE, INJURY VEH ACCIDENT,
STRONGARM ROBBERY, SILENT HOLDUP ALARM, PANIC ALARM
```

### Dallas Police — Priority 1-2 catches crisis-level
Or type whitelist:
```
6X - Major Dist (Violence), 7X - Major Accident, 7XF - Major Accident Freeway,
26/01- Missing Person-Critical
```

### Austin Fire — Crisis Whitelist (12 of 26 types)
```
ATTACK - Active Attack, BOX -Structure Fire, BRUSH - Brush Fire,
ELEC - Electrical Fire, AUTO - Auto Fire, HC - Hazardous Condition,
RESQT - Rescue Task Force, RESQC - Rescue Condition, RESQV - Vehicle Rescue,
Traffic Injury Pri 2, Traffic Injury Pri 2 Rollover
```

---

## Not Viable

| Source | Why |
|---|---|
| **Incident Page Network** (incidentpage.net) | Paid pager/SMS service ($16/mo), no API, human-entered scanner data, site unreliable |
| **Citizen App** | No official API, VC-backed company, ToS risk from scraping |
| **OpenMHz** | Raw scanner audio only — would need speech-to-text + NLP pipeline |
| **Broadcastify/CopCrawler** | Experimental transcription with Whisper, low quality |

---

## Considered: PulsePoint

Excellent data (geocoded, typed, 100+ call types, responding units) from official CAD systems. Hundreds of US agencies.

**Problem**: Official API requires partnership. Web data is AES-encrypted. Open-source scrapers exist but it's fragile and may violate ToS. Consider as Tier 2 after municipal feeds are working.

---

## Implementation Recommendation

**Phase 1**: Build the Socrata adapter + dispatch.js source module. Wire up 4-6 real-time cities (Seattle, SF, Dallas, Austin). Crisis-only filter, 2-4 hour TTL. Adds ~200-500 features. Zero architectural changes needed.

**Phase 2**: Add ArcGIS adapter. Wire up Baltimore, Detroit, Charlotte, Sacramento. Adds ~200-400 more features.

**Phase 3**: Add CSV adapter for Phoenix, San Diego. Evaluate whether daily-update cities add enough value vs. the staleness of the data.

**Each phase is just a new adapter file + config entries. The source module and frontend layer never change.**

---

## Design Spec: Config-Driven Platform Adapters

When we build this, these are the design choices that keep it extensible:

### Adapter contract

Every platform adapter exports one function:

```javascript
async function fetchIncidents(feedConfig) → [ { type, lat, lon, time, address, city, id } ]
```

Takes a config entry, returns normalized objects. All platform-specific logic (auth, pagination, query syntax, field mapping) stays inside the adapter. The dispatch source module never knows what platform it's talking to.

### Config declares the adapter, not code

```json
{ "platform": "socrata", ... }
{ "platform": "arcgis", ... }
```

Dispatch module does `adapters[feed.platform](feed)`. No if/else chains. Adding a platform = write one adapter file, no existing code touched.

### Filtering lives in config

Config says WHAT to filter (crisis types, priority values, hours back). Adapter translates to platform-specific query syntax. Socrata → `$where=`, ArcGIS → `where=`, CSV → post-download filter. Dispatch module doesn't know how filtering works.

### Field mapping is declarative

```json
"fields": { "type": "nature_of_call", "lat": "latitude", "lon": "longitude", "time": "datetime" }
```

Every city names columns differently. Config maps them to standard names. Adapter reads mapping and applies it. No per-city normalization functions.

### Output uses existing feature format

Dispatch module calls `common.js` → `storeFeature()` / `pointFeature()` — same as every other source. Features flow through Redis → `/api/all` → map. Frontend gets one new `LAYER_GROUPS` entry and checkbox.

### One source module, not one per city

`dispatch.js` registered once in `server.js`. Loops through `dispatch-feeds.json` internally. From server's perspective, it's just another source with `fetch()`, `getActive()`, `PREFIX`, `CRON_SCHEDULE`.

### Failures are per-feed

Dallas down? Seattle and SF still work. Per-feed error handling, log and continue. One broken city doesn't take out the layer.

---

## Phase 1 Performance Analysis

Impact of adding 4-6 Socrata cities (crisis-filtered, 4hr TTL) + marker clustering:

| Component | Current (2K features) | With Dispatch (~3.5K) | Concern? |
|-----------|----------------------|----------------------|----------|
| **Redis** | ~2K hashes, trivial | ~3.5K hashes | No — well under 512MB cap |
| **Fetch cycle** | 5 sources on cron | +4-6 small Socrata calls (~20-50 rows each) | No — tiny vs. GDELT's 288-file backfill |
| **API response** | ~1.5MB (~300KB gzipped) | ~2-2.5MB (~500KB gzipped) | No — fine for 5-min poll |
| **Cache rebuild** | `JSON.stringify()` on 2K features | Same on 3.5K | No — milliseconds either way |
| **Frontend parse** | `JSON.parse()` on 1.5MB | Same on 2.5MB | No — negligible difference |
| **buildLayers loop** | 2K markers on canvas | 3.5K into cluster groups | No — clustering actually reduces DOM ops in dense areas |
| **Browser memory** | ~15-20MB | ~25-35MB | No — fine on desktop and mobile |
| **Initial startup** | ~60s (GDELT backfill) | +4-6 requests at <1s each | No — unnoticeable |
| **Page load** | Leaflet (38KB gzip) | +markercluster (35KB gzip) | No — one-time CDN load, cached after |

**No performance boundaries hit.** The architecture handles this comfortably.

**Scaling boundary to watch:** If we later go beyond 20 cities or loosen the crisis filter, the API response size (~5MB+) and browser memory (~60MB+) start mattering. That's when we'd need bbox-based API pagination. But that's Phase 2/3 territory, not Phase 1.

---

## Fallback Plan

This feature is speculative. The app's value is simplicity and focus — a single-pane crisis overview. Dispatch data could strengthen that or dilute it. We won't know until we see it on the map.

**The build is designed to be fully reversible:**

1. **dispatch.js** is one file in `backend/sources/`. Remove the `require()` from server.js and the source is gone. Zero impact on existing sources.

2. **dispatch-feeds.json** is a standalone config file. Delete it.

3. **Socrata adapter** is one file. Delete it.

4. **Frontend changes** are one `LAYER_GROUPS` entry and one checkbox section in index.html. Remove both — 10 lines.

5. **Marker clustering** is the only change that touches existing code (layer groups become cluster groups). But clustering has standalone value even without dispatch — it improves the existing map at zoom levels where weather and conflict markers overlap. **If dispatch gets cut, clustering stays.**

**Total rollback if dispatch doesn't work out:** Delete 3 files, remove ~15 lines across server.js and index.html/app.js. Everything else in the app is untouched.

**Decision point:** After Phase 1 ships with 4-6 cities, evaluate on the live map:
- Does the dispatch layer add useful signal or just noise?
- Do the crisis-type filters catch the right things?
- Does it feel like the same app or a different product?

If the answer is "different product" — cut it, keep clustering, move on. The research and design spec stay in this doc for if/when the time is right.
