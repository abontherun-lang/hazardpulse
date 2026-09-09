# Vendored frontend libraries

Served by the app itself so the map works with no third-party CDN reachable
(unpkg was the only external script host; a filtered or offline network broke
the whole page).

| Library | Version | Source |
|---|---|---|
| Leaflet | 1.9.4 | https://unpkg.com/leaflet@1.9.4/dist/ (leaflet.js, leaflet.css, images/) |
| Leaflet.markercluster | 1.5.3 | https://unpkg.com/leaflet.markercluster@1.5.3/dist/ |

To upgrade: replace the files with the new `dist/` contents, update the
version here and in `frontend/index.html`, and check the map still renders.
