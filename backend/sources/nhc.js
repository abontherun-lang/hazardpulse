/**
 * National Hurricane Center — active tropical cyclones
 * Index:    https://www.nhc.noaa.gov/CurrentStorms.json (every active storm, its
 *           position, intensity and the "bin" its GIS products live under)
 * Products: NHC_tropical_weather ArcGIS MapServer, per-bin layers
 *           "<bin> Forecast Points / Forecast Track / Forecast Cone /
 *           Advisory Wind Field", all served as GeoJSON (f=geojson).
 * Auth: None. Rate: no published limit. We poll every 15 min, with NOAA.
 *
 * The NWS alert feed (noaa.js) carries the hurricane, tropical storm and
 * surge *warnings* as county fills. This source carries the *storm*: a
 * center marker by Saffir-Simpson category, the 5-day forecast track with
 * its points and cone, and the current 34/50/64 kt wind field.
 *
 * Gotchas:
 * - Bins (AT1..AT5, EP1..EP5, CP1..CP5) are reused storm after storm, and a
 *   bin's layers keep the last storm's products after it dissipates. Every
 *   product is checked against the storm id from the index before storing.
 * - The GIS products are published on full advisories (every 6 h). The
 *   index updates on intermediate advisories (every 3 h) as well, so the
 *   center comes from the index and may be ahead of the cone/track.
 * - Ids are stable per storm and product (center, cone, track, point per
 *   tau, ring per radius) so each advisory replaces the previous one and a
 *   dissipated storm expires on its own. A product id never changes geometry
 *   type — the store keeps an old polygon when a new row is a point.
 * - ArcGIS returns ~13 decimal places; coordinates are rounded to 4 (11 m),
 *   which halves the cone and wind-field payloads.
 */

const { http } = require('../http');
const { text, TTL, storeEvents, setLastUpdate } = require('./common');
const { colorOf } = require('../layers');

const SOURCE_NAME = 'NHC';
const CRON_SCHEDULE = '*/15 * * * *';
const PREFIX = 'nhc';
const INDEX_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const SERVICE_URL = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

const CATEGORY = {
  CENTER: 'Tropical Cyclone',
  FORECAST: 'Tropical Cyclone Forecast',
  WIND: 'Tropical Cyclone Wind Field'
};

// Layer names in the service, per bin; resolved to ids from the service metadata.
const PRODUCTS = {
  points: 'Forecast Points',
  track: 'Forecast Track',
  cone: 'Forecast Cone',
  wind: 'Advisory Wind Field'
};

// Saffir-Simpson tones, TD and TS first. The legend swatch is the Cat 1 tone.
const SS_COLORS = {
  TD: '#42A5F5', TS: '#26A69A',
  1: '#FFB300', 2: '#FB8C00', 3: '#E53935', 4: '#AD1457', 5: '#6A1B9A'
};
const RADII_COLORS = { 34: '#FDD835', 50: '#FB8C00', 64: '#E53935' };

const KT_TO_MPH = 1.15078;

/** Saffir-Simpson category for a sustained wind in knots; 0 below hurricane force. */
function saffirSimpson(kt) {
  const v = Number(kt) || 0;
  if (v >= 137) return 5;
  if (v >= 113) return 4;
  if (v >= 96) return 3;
  if (v >= 83) return 2;
  if (v >= 64) return 1;
  return 0;
}

/**
 * Status label, short tag and color for an index classification + intensity.
 * NHC classifications: TD, TS, HU, STD, STS (subtropical), PTC (potential), PC.
 */
function describeStorm(classification, kt) {
  const cls = String(classification || '').toUpperCase();
  const cat = saffirSimpson(kt);
  if (cls === 'HU' || cat >= 1) {
    const c = Math.max(cat, 1);
    return { label: `Category ${c} Hurricane`, kind: 'Hurricane', cat: c, tag: `H${c}`, color: SS_COLORS[c] };
  }
  if (cls === 'TS') return { label: 'Tropical Storm', kind: 'Tropical Storm', cat: 0, tag: 'TS', color: SS_COLORS.TS };
  if (cls === 'STS') return { label: 'Subtropical Storm', kind: 'Subtropical Storm', cat: 0, tag: 'SS', color: SS_COLORS.TS };
  if (cls === 'TD') return { label: 'Tropical Depression', kind: 'Tropical Depression', cat: 0, tag: 'TD', color: SS_COLORS.TD };
  if (cls === 'STD') return { label: 'Subtropical Depression', kind: 'Subtropical Depression', cat: 0, tag: 'SD', color: SS_COLORS.TD };
  if (cls === 'PTC' || cls === 'PC') return { label: 'Potential Tropical Cyclone', kind: 'Potential Tropical Cyclone', cat: 0, tag: 'PTC', color: SS_COLORS.TD };
  return { label: text(classification) || 'Tropical Cyclone', kind: 'Tropical Cyclone', cat: 0, tag: cls.slice(0, 3) || 'TC', color: SS_COLORS.TD };
}

function severityFor(desc) {
  if (desc.cat >= 3) return 'Extreme';
  if (desc.cat >= 1) return 'Severe';
  if (desc.kind.endsWith('Storm')) return 'Moderate';
  return 'Minor';
}

function compass(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return '';
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
}

function mph(kt) {
  const v = Number(kt);
  return Number.isFinite(v) ? Math.round(v * KT_TO_MPH) : null;
}

function roundCoords(c) {
  if (typeof c === 'number') return Math.round(c * 1e4) / 1e4;
  return Array.isArray(c) ? c.map(roundCoords) : c;
}

function roundGeometry(g) {
  if (!g || !g.type || !g.coordinates) return null;
  return { type: g.type, coordinates: roundCoords(g.coordinates) };
}

/** Map the service's layer list to { points, track, cone, wind } ids for one bin. */
function layerIds(serviceMeta, bin) {
  const byName = new Map((serviceMeta && serviceMeta.layers || []).map(l => [l.name, l.id]));
  const ids = {};
  for (const [key, name] of Object.entries(PRODUCTS)) {
    const id = byName.get(`${bin} ${name}`);
    if (Number.isInteger(id)) ids[key] = id;
  }
  return ids;
}

/** "al092026" → { basin: "AL", stormnum: 9 }; the fields the products carry. */
function parseStormId(id) {
  const m = /^([a-z]{2})(\d{2})(\d{4})$/i.exec(String(id || ''));
  return m ? { basin: m[1].toUpperCase(), stormnum: parseInt(m[2], 10), year: parseInt(m[3], 10) } : null;
}

/** Does a product feature belong to this storm? Bins are reused, so check. */
function belongsTo(storm, props) {
  const want = parseStormId(storm.id);
  if (!want || !props) return false;
  if (props.stormid) return String(props.stormid).toLowerCase() === String(storm.id).toLowerCase();
  const basin = String(props.basin || '').toUpperCase();
  return basin === want.basin && Number(props.stormnum) === want.stormnum;
}

/** The storm's center from the index entry. */
function normalizeCenter(storm, now = Date.now()) {
  const lat = Number(storm.latitudeNumeric), lon = Number(storm.longitudeNumeric);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !storm.id) return null;
  const kt = Number(storm.intensity) || 0;
  const desc = describeStorm(storm.classification, kt);
  const issued = Date.parse(storm.lastUpdate) || now;
  const name = text(storm.name) || 'Unnamed';
  const adv = text(storm.publicAdvisory && storm.publicAdvisory.advNum).replace(/^0+/, '');
  const moveDir = compass(storm.movementDir);
  const moveMph = mph(storm.movementSpeed);

  return {
    id: `nhc-${storm.id}-center`,
    event: CATEGORY.CENTER,
    category: CATEGORY.CENTER,
    severity: severityFor(desc),
    headline: `${desc.kind} ${name}`,
    description: `${desc.label}. Maximum sustained winds ${mph(kt) ?? '?'} mph` +
      (moveDir ? `, moving ${moveDir} at ${moveMph ?? '?'} mph` : '') +
      (storm.pressure ? `, ${storm.pressure} mb` : '') + '.',
    areaDesc: `${(parseStormId(storm.id) || {}).basin || ''} basin`.trim(),
    color: desc.color,
    sourceUrl: text(storm.publicAdvisory && storm.publicAdvisory.url) || 'https://www.nhc.noaa.gov/',
    timestamp: issued,
    geometry: { type: 'Point', coordinates: [roundCoords(lon), roundCoords(lat)] },
    product: 'center',
    stormId: storm.id,
    stormName: name,
    status: desc.label,
    tag: desc.tag,
    category_ss: desc.cat,
    windKt: kt,
    windMph: mph(kt),
    pressureMb: Number(storm.pressure) || null,
    moveDir,
    moveMph,
    advisory: adv,
    graphicsUrl: text(storm.forecastGraphics && storm.forecastGraphics.url) || ''
  };
}

/**
 * Cone, track, forecast points and wind rings for one storm. Each product's
 * GeoJSON may be missing (fetch failed) — the others still store.
 */
function normalizeProducts(storm, products, now = Date.now()) {
  const events = [];
  const name = text(storm.name) || 'Unnamed';
  const feats = key => ((products[key] && products[key].features) || []).filter(f => f.geometry && belongsTo(storm, f.properties));
  const base = (p) => ({
    stormId: storm.id,
    stormName: name,
    advisory: text(p.advisnum || p.advnum).replace(/^0+/, ''),
    issued: text(p.advdate),
    sourceUrl: text(storm.forecastGraphics && storm.forecastGraphics.url) || 'https://www.nhc.noaa.gov/',
    timestamp: Number(p.idp_filedate) || Date.parse(storm.lastUpdate) || now
  });

  for (const f of feats('cone')) {
    const p = f.properties, b = base(p);
    events.push({
      id: `nhc-${storm.id}-cone`,
      event: CATEGORY.FORECAST, category: CATEGORY.FORECAST, severity: 'Moderate',
      headline: `${name} — forecast cone, advisory ${b.advisory}`,
      description: `Probable track of the center over the next ${p.fcstprd || 120} hours (two-thirds of historical track errors). Issued ${b.issued}.`,
      areaDesc: '', color: colorOf(CATEGORY.FORECAST),
      geometry: roundGeometry(f.geometry),
      product: 'cone', hours: p.fcstprd || 120, ...b
    });
    break; // one cone per storm
  }

  for (const f of feats('track')) {
    const p = f.properties, b = base(p);
    events.push({
      id: `nhc-${storm.id}-track`,
      event: CATEGORY.FORECAST, category: CATEGORY.FORECAST, severity: 'Moderate',
      headline: `${name} — forecast track, advisory ${b.advisory}`,
      description: `Forecast position of the center at 12-hour steps. Issued ${b.issued}.`,
      areaDesc: '', color: colorOf(CATEGORY.FORECAST),
      geometry: roundGeometry(f.geometry),
      product: 'track', ...b
    });
    break;
  }

  for (const f of feats('points')) {
    const p = f.properties, b = base(p);
    const tau = Number(p.tau);
    if (!Number.isInteger(tau)) continue;
    const desc = describeStorm(p.stormtype === 'HU' || p.dvlbl === 'H' || p.dvlbl === 'M' ? 'HU' : p.tcdvlp, p.maxwind);
    events.push({
      id: `nhc-${storm.id}-fcst-${tau}`,
      event: CATEGORY.FORECAST, category: CATEGORY.FORECAST, severity: 'Moderate',
      headline: `${name} — ${text(p.tcdvlp) || desc.kind} ${text(p.datelbl)}`.trim(),
      description: `Forecast +${tau} h: ${text(p.tcdvlp) || desc.kind}, winds ${mph(p.maxwind) ?? '?'} mph, gusts ${mph(p.gust) ?? '?'} mph.`,
      areaDesc: '', color: desc.color,
      geometry: roundGeometry(f.geometry),
      product: 'point', tau, label: text(p.datelbl), letter: text(p.dvlbl) || desc.tag.charAt(0),
      status: text(p.tcdvlp) || desc.kind, category_ss: Number(p.ssnum) || desc.cat,
      windKt: Number(p.maxwind) || null, windMph: mph(p.maxwind), gustMph: mph(p.gust),
      ...b
    });
  }

  for (const f of feats('wind')) {
    const p = f.properties, b = base(p);
    const radii = Number(p.radii);
    if (![34, 50, 64].includes(radii)) continue;
    events.push({
      id: `nhc-${storm.id}-wind-${radii}`,
      event: CATEGORY.WIND, category: CATEGORY.WIND, severity: radii === 64 ? 'Severe' : 'Moderate',
      headline: `${name} — ${radii} kt wind field`,
      description: `Area of sustained winds of at least ${radii} kt (${mph(radii)} mph) at advisory time. Extent by quadrant (nm): NE ${p.ne ?? '?'}, SE ${p.se ?? '?'}, SW ${p.sw ?? '?'}, NW ${p.nw ?? '?'}.`,
      areaDesc: '', color: RADII_COLORS[radii],
      geometry: roundGeometry(f.geometry),
      product: 'wind', radii, radiiMph: mph(radii),
      quadrantsNm: { ne: p.ne ?? null, se: p.se ?? null, sw: p.sw ?? null, nw: p.nw ?? null },
      ...b
    });
  }

  return events;
}

let serviceMetaCache = null;

async function getServiceMeta(force = false) {
  if (serviceMetaCache && !force) return serviceMetaCache;
  const res = await http.get(`${SERVICE_URL}?f=json`, { timeout: 15000 });
  if (!res.data || !Array.isArray(res.data.layers)) throw new Error('NHC service metadata has no layers');
  serviceMetaCache = res.data;
  return serviceMetaCache;
}

async function fetchLayer(id) {
  const res = await http.get(`${SERVICE_URL}/${id}/query?where=1%3D1&outFields=*&f=geojson`, { timeout: 25000 });
  if (res.data && res.data.error) throw new Error(JSON.stringify(res.data.error).slice(0, 200));
  return res.data;
}

async function fetch() {
  console.log('\n🌀 Fetching active tropical cyclones from NHC...');
  let index;
  try {
    index = (await http.get(INDEX_URL, { timeout: 15000 })).data;
  } catch (e) {
    console.error(`   NHC index error: ${e.message}`);
    throw e;
  }
  const storms = (index && index.activeStorms) || [];
  console.log(`   Active storms: ${storms.length}${storms.length ? ' (' + storms.map(s => s.name).join(', ') + ')' : ''}`);

  const events = [];
  let meta = null;
  for (const storm of storms) {
    const center = normalizeCenter(storm);
    if (center) events.push(center);
    if (!storm.binNumber) continue;

    try {
      meta = meta || await getServiceMeta();
      let ids = layerIds(meta, storm.binNumber);
      if (Object.keys(ids).length < 4) { meta = await getServiceMeta(true); ids = layerIds(meta, storm.binNumber); }
      const keys = Object.keys(ids);
      const results = await Promise.allSettled(keys.map(k => fetchLayer(ids[k])));
      const products = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') products[keys[i]] = r.value;
        else console.warn(`   [NHC] ${storm.name} ${keys[i]}: ${r.reason && r.reason.message}`);
      });
      const made = normalizeProducts(storm, products);
      events.push(...made);
      console.log(`   ${storm.name} (${storm.binNumber}): center + ${made.length} products`);
    } catch (e) {
      console.warn(`   [NHC] ${storm.name}: products skipped — ${e.message}`);
    }
  }

  await storeEvents(SOURCE_NAME, events, TTL.NHC);
  console.log(`   ✓ Stored ${events.length} NHC features`);
  await setLastUpdate(SOURCE_NAME, storms.length);
  return { total: storms.length, stored: events.length };
}

module.exports = {
  fetch, SOURCE_NAME, CRON_SCHEDULE, PREFIX,
  CATEGORY, SS_COLORS, RADII_COLORS,
  saffirSimpson, describeStorm, compass, layerIds, parseStormId, belongsTo,
  normalizeCenter, normalizeProducts, roundGeometry
};
