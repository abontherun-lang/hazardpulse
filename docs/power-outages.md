# Power Outages Layer — Research Notes

**Date**: 2026-03-29
**Status**: Researched, not yet implemented

---

## Recommended Source: Kubra StormCenter

Kubra powers the outage maps for dozens of major US utilities. Their data is publicly accessible via static JSON files on `kubra.io` with no authentication required. Updates every few minutes.

### How It Works (3-step fetch, all unauthenticated)

**Step 1** — Get current deployment state:
```
GET https://kubra.io/stormcenter/api/v1/stormcenters/{instanceId}/views/{viewId}/currentState?preview=false
```
Returns JSON with deployment IDs and data paths (changes each update cycle).

**Step 2** — Get summary (total outage count):
```
GET https://kubra.io/{interval_generation_data_path}/public/summary-1/data.json
```
Returns total outage count, customers affected, percentage, timestamp.

**Step 3** — Get individual outages with geographic data:
```
GET https://kubra.io/{cluster_interval_generation_data_path}/public/{cluster_layer_id}/{quadkey}.json
```
Requires `Accept-Encoding: gzip` header. Returns JSON with per-outage records including:
- `n_out` — number of outages
- `cust_a.val` — customers affected
- `etr` — estimated time of restoration (ISO 8601)
- `cause`, `crew_status`, `comments`
- `geom.p` — lat/lon as Google encoded polyline
- `cluster` flag (true = aggregated, false = individual outage)

### Verified Working Utility Instances (tested 2026-03-29)

| Utility | Customers | instanceId | viewId |
|---|---|---|---|
| Georgia Power | 2,769,920 | `7b38c047-7950-444b-a25c-9b3e5ab986eb` | `67b44af5-3847-4ca3-9f4e-9190aac343d6` |
| Oncor (Texas) | 4,144,697 | `560abba3-7881-4741-b538-ca416b58ba1e` | `ca124b24-9a06-4b19-aeb3-1841a9c962e1` |
| Alabama Power | 1,605,993 | `7636a60f-7b81-4fb0-a30d-ed79a8e271e7` | `c3471c92-6e1b-494b-a884-391139a2cc18` |

### Finding More Utility IDs

Visit any utility's outage map page (e.g. `https://outagemap.georgiapower.com`), view page source, search for `instanceId` and `viewId` in the `BOOTSTRAP_CONFIG` JavaScript object. Known Kubra-powered utilities include Duke Energy, Entergy, Eversource, PPL Electric, and many others.

### Quadkey Tiles

To fetch cluster data you need quadkey tile coordinates covering the utility's service area. These can be derived from the service area polygon returned by `serviceareas.json`. Zoom level 7 tiles are a good starting resolution.

### Existing Library

`pip install kubra` (from `https://github.com/fgregg/kubra`) — Python library that handles the full 3-step scraping logic and outputs GeoJSON. Could be used directly or as a reference for a Node.js port.

---

## Sources That Don't Work

| Source | Why |
|---|---|
| **PowerOutage.us** | Behind Cloudflare, API returns 401. Paid product only. |
| **DOE Eagle-I** | Requires government credentials, 401 on all endpoints. |
| **GridStatus.io** | Requires paid API key. Also tracks grid operations, not customer outages. |
| **EIA API** | Historical/statistical data only, not real-time outages. |
| **NWS Weather API** | Does not track power outages (`?event=Power%20Outage` returns empty). |
| **FPL (Florida)** | Behind Imperva WAF, blocks programmatic access. |
| **CenterPoint (Houston)** | ArcGIS SPA, requires JS rendering. |

---

## Implementation Plan (when ready)

1. Start with the 3 verified utilities above (~8.5M customers across GA, TX, AL)
2. Add more Kubra utilities by scraping their outage map pages for instance/view IDs
3. Fetch on a 10-minute cron schedule
4. Store in Redis with `outage:` prefix, 1-hour TTL
5. API endpoint: `GET /api/outages`
6. Frontend: new "Power Outages" legend section, markers colored by severity (customers affected)
7. Consider using the `fgregg/kubra` Python library as a subprocess, or port the logic to Node.js

### Suggested colors
- 10,000+ customers: dark red
- 1,000-9,999: orange
- 100-999: yellow
- < 100: light gray

### Backend fetcher pseudocode
```javascript
async function fetchOutages() {
  for (const utility of UTILITIES) {
    // Step 1: get current state
    const state = await fetch(`https://kubra.io/stormcenter/api/v1/stormcenters/${utility.instanceId}/views/${utility.viewId}/currentState?preview=false`);
    // Step 2: extract data paths from state
    // Step 3: fetch cluster tiles for the utility's service area quadkeys
    // Step 4: parse outage records, decode polyline coords, store in Redis
  }
}
```
