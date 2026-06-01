// ===================== INIT =====================

const API_URL = '/api';

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function safeColor(val, fallback) {
  return /^#[0-9a-fA-F]{3,8}$/.test(val) ? val : (fallback || '#808080');
}

const map = L.map('map', { preferCanvas: true }).setView([39.8283, -98.5795], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// ===================== LAYER CONFIG =====================

const LAYER_GROUPS = {
  weather: {
    label: 'Weather Alerts',
    types: [
      'Tornado Warning', 'Tornado Watch', 'Tornado Report',
      'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
      'Flood Warning', 'Flood Watch',
      'Special Weather Statement', 'Winter Weather Advisory', 'Wind Advisory'
    ]
  },
  tropical: {
    label: 'Hurricanes / Tropical',
    types: [
      'Hurricane Warning', 'Hurricane Watch',
      'Tropical Storm Warning', 'Tropical Storm Watch',
      'Storm Surge Warning', 'Storm Surge Watch'
    ]
  },
  earthquake: {
    label: 'Earthquakes / Tsunami',
    types: ['Earthquake', 'Tsunami Warning', 'Tsunami Watch', 'Tsunami Advisory', 'Earthquake Warning']
  },
  wildfire: {
    label: 'Wildfires',
    types: ['Wildfire', 'Wildfire Incident', 'Red Flag Warning', 'Fire Weather Watch']
  },
  volcano: {
    label: 'Volcanoes',
    types: ['Volcano']
  },
  emergency: {
    label: 'Emergency Alerts',
    types: ['Official Alerts', 'Missing Persons']
  },
  dispatch: {
    label: '911 Dispatch',
    types: ['Dispatch Fire', 'Dispatch Violence', 'Dispatch Accident', 'Dispatch Hazmat']
  },
  conflict: {
    label: 'Conflict & Unrest',
    types: ['Protest', 'Armed Violence', 'Use of Force']
  }
};

const DATA_TYPES = Object.values(LAYER_GROUPS).flatMap(g => g.types);

const CLUSTERED_TYPES = new Set([
  'Earthquake', 'Wildfire', 'Wildfire Incident', 'Tornado Report',
  'Protest', 'Armed Violence', 'Use of Force',
  'Dispatch Fire', 'Dispatch Violence', 'Dispatch Accident', 'Dispatch Hazmat'
]);

const CLUSTER_OPTIONS = {
  maxClusterRadius: 40,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  iconCreateFunction(cluster) {
    const count = cluster.getChildCount();
    const size = count > 50 ? 'lg' : count > 10 ? 'md' : 'sm';
    return L.divIcon({
      html: `<div>${count}</div>`,
      className: `cluster cluster-${size}`,
      iconSize: L.point(32, 32)
    });
  }
};

const WATCH_TYPES = new Set([
  'Tornado Watch', 'Severe Thunderstorm Watch', 'Flood Watch',
  'Hurricane Watch', 'Tropical Storm Watch', 'Storm Surge Watch',
  'Tsunami Watch', 'Tsunami Advisory', 'Fire Weather Watch',
  'Special Weather Statement', 'Winter Weather Advisory', 'Wind Advisory'
]);

// ===================== COLOR MAPS =====================

const ALERT_COLORS = {
  'Tornado Warning': '#0D47A1', 'Tornado Watch': '#1565C0',
  'Severe Thunderstorm Warning': '#1976D2', 'Severe Thunderstorm Watch': '#42A5F5',
  'Special Weather Statement': '#546E7A', 'Winter Weather Advisory': '#78909C', 'Wind Advisory': '#607D8B',
  'Flood Warning': '#1A237E', 'Flood Watch': '#3949AB',
  'Red Flag Warning': '#E65100', 'Fire Weather Watch': '#FF8F00',
  'Hurricane Warning': '#006064', 'Hurricane Watch': '#00838F',
  'Tropical Storm Warning': '#0097A7', 'Tropical Storm Watch': '#26C6DA',
  'Storm Surge Warning': '#004D40', 'Storm Surge Watch': '#00897B',
  'Tsunami Warning': '#01579B', 'Tsunami Watch': '#0277BD', 'Tsunami Advisory': '#0288D1',
  'Earthquake Warning': '#795548'
};

const GDELT_COLORS = {
  'Protest': '#F9A825',
  'Armed Violence': '#B71C1C',
  'Use of Force': '#C62828'
};

const DISPATCH_COLORS = {
  'Dispatch Fire': '#FF6D00',
  'Dispatch Violence': '#D500F9',
  'Dispatch Accident': '#FFAB00',
  'Dispatch Hazmat': '#00E676'
};

// Merged color map for status panel dots
const TYPE_COLORS = { ...ALERT_COLORS, ...GDELT_COLORS, ...DISPATCH_COLORS,
  'Tornado Report': '#0D47A1', 'Earthquake': '#6D4C41', 'Earthquake Warning': '#5D4037',
  'Wildfire': '#FF8F00', 'Wildfire Incident': '#D84315', 'Volcano': '#E65100',
  'Official Alerts': '#D50000', 'Missing Persons': '#FF6F00'
};

// ===================== LAYER STATE =====================

const layerGroups = {};
let allData = { features: [], meta: {} };

function getLayerGroup(type) {
  if (!layerGroups[type]) {
    layerGroups[type] = CLUSTERED_TYPES.has(type)
      ? L.markerClusterGroup(CLUSTER_OPTIONS)
      : L.layerGroup();
  }
  return layerGroups[type];
}

DATA_TYPES.forEach(type => getLayerGroup(type));

// ===================== DOM CACHE =====================

const domCache = {};
function getEl(sel) {
  if (!domCache[sel]) domCache[sel] = document.querySelector(sel);
  return domCache[sel];
}
function getCheckbox(type) { return getEl(`input[data-type="${type}"]`); }
function getGroupCheckbox(key) { return getEl(`input[data-group="${key}"]`); }
function getSatCheckbox(id) { return getEl(`input[data-sat="${id}"]`); }

// ===================== TIME FILTER =====================

let timeFilterMin = 0;
let timeFilterMax = 0;
let timeFilterValue = 0;

function initTimeFilter() {
  if (allData.meta?.timeBounds?.max > 0) {
    timeFilterMin = allData.meta.timeBounds.min;
    timeFilterMax = allData.meta.timeBounds.max;
  } else {
    const timestamps = allData.features.map(f => f.properties.timestamp).filter(t => t > 0);
    if (!timestamps.length) return;
    timeFilterMin = timestamps.reduce((a, b) => a < b ? a : b);
    timeFilterMax = timestamps.reduce((a, b) => a > b ? a : b);
  }

  const saved = parseInt(sessionStorage.getItem('timeFilterValue'));
  timeFilterValue = (saved >= timeFilterMin && saved <= timeFilterMax) ? saved : timeFilterMin;

  const slider = document.getElementById('time-slider');
  if (!slider) return;
  slider.min = timeFilterMin;
  slider.max = timeFilterMax;
  slider.value = timeFilterValue;
  slider.step = 3600000;
  updateTimeLabel();
  updateSliderTrack();
}

function onTimeSliderChange(val) {
  timeFilterValue = parseInt(val);
  sessionStorage.setItem('timeFilterValue', timeFilterValue);
  updateTimeLabel();
  updateSliderTrack();
  buildLayers();
  notifyStatusDirty();
}

function updateSliderTrack() {
  const slider = document.getElementById('time-slider');
  if (!slider || timeFilterMax <= timeFilterMin) return;
  const pct = ((Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
  slider.style.setProperty('background',
    `linear-gradient(to right, rgba(0,240,255,0.15) ${pct}%, rgba(0,240,255,0.6) ${pct}%)`, 'important');
}

function updateTimeLabel() {
  const label = document.getElementById('time-label');
  if (!label) return;
  if (timeFilterValue <= timeFilterMin) {
    label.textContent = 'Showing all events';
  } else {
    const d = new Date(timeFilterValue);
    label.textContent = `From: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
  }
}

function passesTimeFilter(feature) {
  if (timeFilterValue <= timeFilterMin) return true;
  const ts = feature.properties.timestamp;
  return !ts || ts >= timeFilterValue;
}

// ===================== ZOOM FILTER =====================

function passesZoomFilter(feature, zoom) {
  const { source, mag, frp, severity, category } = feature.properties;

  if (source === 'USGS') {
    const m = parseFloat(mag) || 0;
    if (zoom <= 4) return m >= 3.0;
    if (zoom <= 6) return m >= 2.0;
    if (zoom <= 8) return m >= 1.0;
    return true;
  }
  if (source === 'NASA FIRMS') {
    const f = parseFloat(frp) || 0;
    if (zoom <= 4) return f >= 10;
    if (zoom <= 6) return f >= 3;
    return true;
  }
  if (source === 'NIFC') {
    const ac = parseFloat(feature.properties.acres) || 0;
    if (zoom <= 4) return ac >= 1000;
    if (zoom <= 6) return ac >= 100;
    return true;
  }
  if (source === 'USGS Volcano') return true; // sparse + important: always shown
  if (source === 'GDELT') {
    if (zoom <= 4) return severity === 'Extreme' || severity === 'Severe';
    if (zoom <= 6) return severity !== 'Moderate' || category !== 'Fight';
    return true;
  }
  return true;
}

// ===================== VISIBILITY =====================

function syncLayerVisibility() {
  DATA_TYPES.forEach(type => {
    const cb = getCheckbox(type);
    const group = layerGroups[type];
    if (!group) return;
    const show = cb ? cb.checked : true;
    if (show && !map.hasLayer(group)) map.addLayer(group);
    else if (!show && map.hasLayer(group)) map.removeLayer(group);
  });
}

function toggleType() {
  syncLayerVisibility();
  notifyStatusDirty();
}

function toggleGroup(groupKey) {
  const checked = getGroupCheckbox(groupKey)?.checked ?? false;
  LAYER_GROUPS[groupKey].types.forEach(type => {
    const cb = getCheckbox(type);
    if (cb) cb.checked = checked;
  });
  syncLayerVisibility();
  notifyStatusDirty();
}

function toggleCollapse(groupKey) {
  const body = getEl(`.legend-body[data-group="${groupKey}"]`);
  const arrow = getEl(`.collapse-arrow[data-group="${groupKey}"]`);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? 'block' : 'none';
  if (arrow) arrow.textContent = collapsed ? '\u25BC' : '\u25B6';
}

function updateGroupCheckbox(groupKey) {
  const types = LAYER_GROUPS[groupKey].types;
  const gcb = getGroupCheckbox(groupKey);
  if (!gcb) return;
  const checked = types.filter(t => getCheckbox(t)?.checked);
  gcb.checked = checked.length > 0;
  gcb.indeterminate = checked.length > 0 && checked.length < types.length;
}

// ===================== SATELLITE / RADAR =====================

const satelliteLayers = {
  'sat-ir': L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-ir-4km-900913/{z}/{x}/{y}.png', { opacity: 0.5, attribution: 'GOES-East &copy; Iowa Environmental Mesonet', maxZoom: 10 }),
  'sat-vis': L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-vis-1km-900913/{z}/{x}/{y}.png', { opacity: 0.5, attribution: 'GOES-East &copy; Iowa Environmental Mesonet', maxZoom: 10 }),
  'sat-wv': L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-east-wv-4km-900913/{z}/{x}/{y}.png', { opacity: 0.5, attribution: 'GOES-East &copy; Iowa Environmental Mesonet', maxZoom: 10 }),
  'radar': null
};

async function loadRadarLayer() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    const frames = data.radar?.past;
    if (!frames?.length) return;
    satelliteLayers['radar'] = L.tileLayer(
      `https://tilecache.rainviewer.com${frames[frames.length - 1].path}/256/{z}/{x}/{y}/6/1_1.png`,
      { opacity: 0.55, attribution: 'RainViewer', maxZoom: 7 }
    );
  } catch (e) { console.error('Radar load failed:', e); }
}

function syncSatelliteVisibility() {
  for (const [id, layer] of Object.entries(satelliteLayers)) {
    if (!layer) continue;
    const show = getSatCheckbox(id)?.checked ?? false;
    if (show && !map.hasLayer(layer)) map.addLayer(layer);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function setSatelliteOpacity(val) {
  const opacity = parseFloat(val);
  Object.values(satelliteLayers).forEach(l => { if (l && map.hasLayer(l)) l.setOpacity(opacity); });
}

// ===================== LOAD & BUILD =====================

let lastEtag = null;

async function loadAll() {
  try {
    const headers = {};
    if (lastEtag) headers['If-None-Match'] = lastEtag;

    const response = await fetch(`${API_URL}/all`, { headers });
    if (response.status === 304) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    lastEtag = response.headers.get('etag');
    allData = await response.json();
    initTimeFilter();
    buildLayers();
    syncLayerVisibility();
    document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    notifyStatusDirty();
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function buildLayers() {
  const zoom = map.getZoom();
  DATA_TYPES.forEach(type => getLayerGroup(type).clearLayers());

  for (const feature of allData.features) {
    try {
      if (!passesTimeFilter(feature)) continue;
      if (!passesZoomFilter(feature, zoom)) continue;
      const source = feature.properties.source;
      if (source === '911 Dispatch') buildDispatchMarker(feature);
      else if (source === 'GDELT') buildGdeltMarker(feature);
      else if (source === 'NASA FIRMS') buildFireMarker(feature);
      else if (source === 'NIFC') buildNifcMarker(feature);
      else if (source === 'USGS Volcano') buildVolcanoMarker(feature);
      else if (source === 'USGS') buildQuakeMarker(feature);
      else if (source === 'FEMA IPAWS') buildFemaMarker(feature);
      else if (source === 'SPC') buildTornadoReportMarker(feature);
      else buildWeatherMarker(feature);
    } catch (e) {
      console.warn('Skipping bad feature:', e.message, feature?.id);
    }
  }
}

// Rebuild markers only when zoom crosses a filter threshold
let lastZoomBucket = null;
function getZoomBucket(z) {
  if (z <= 4) return 4;
  if (z <= 6) return 6;
  if (z <= 8) return 8;
  return 10;
}

map.on('zoomend', () => {
  const bucket = getZoomBucket(map.getZoom());
  if (bucket !== lastZoomBucket && allData.features.length > 0) {
    lastZoomBucket = bucket;
    buildLayers();
  }
});

map.on('moveend', () => {
  if (allData.features.length > 0) notifyStatusDirty();
});

// ===================== MARKER BUILDERS =====================

function severityOpacity(severity) {
  switch (severity) {
    case 'Extreme': return 1.0;
    case 'Severe': return 0.85;
    case 'Moderate': return 0.55;
    case 'Minor': case 'Low': case 'Micro': return 0.35;
    default: return 0.6;
  }
}

function buildWeatherMarker(feature) {
  const props = feature.properties;
  const eventType = props.event;
  const group = layerGroups[eventType];
  if (!group || !feature.geometry) return;

  const color = props.color || ALERT_COLORS[eventType] || '#808080';
  const watch = WATCH_TYPES.has(eventType);
  let layer;

  if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
    layer = L.geoJSON(feature, {
      style: watch
        ? { fillColor: color, fillOpacity: 0.08, color, weight: 3, opacity: 0.6, dashArray: '6 4' }
        : { fillColor: color, fillOpacity: 0.25, color, weight: 2.5, opacity: 0.9 }
    });
  } else if (feature.geometry.type === 'Point') {
    const c = feature.geometry.coordinates;
    layer = L.circleMarker([c[1], c[0]], {
      radius: watch ? 6 : 8, fillColor: color, fillOpacity: watch ? 0.4 : 0.8,
      color: '#fff', weight: 2
    });
  } else return;

  layer.bindPopup(createWeatherPopup(props), { maxWidth: 350, maxHeight: 400 });
  layer.addTo(group);
}

function buildGdeltMarker(feature) {
  const props = feature.properties;
  const group = layerGroups[props.category];
  if (!group || !feature.geometry) return;

  const color = props.color || GDELT_COLORS[props.category] || '#808080';
  const c = feature.geometry.coordinates;
  const opacity = severityOpacity(props.severity);
  const size = props.severity === 'Extreme' ? 10 : props.severity === 'Severe' ? 8 : 6;

  const marker = L.circleMarker([c[1], c[0]], {
    radius: size, fillColor: color, fillOpacity: opacity,
    color: '#fff', weight: 1, opacity
  });
  marker.bindPopup(createGdeltPopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildFireMarker(feature) {
  const props = feature.properties;
  const group = layerGroups['Wildfire'];
  if (!group || !feature.geometry) return;

  const color = props.color || '#FF8F00';
  const c = feature.geometry.coordinates;
  const frp = parseFloat(props.frp) || 0;
  const radius = frp >= 50 ? 9 : frp >= 10 ? 6 : 4;
  const opacity = severityOpacity(props.severity);

  const marker = L.circleMarker([c[1], c[0]], {
    radius, fillColor: color, fillOpacity: opacity,
    color: '#BF360C', weight: frp >= 10 ? 2 : 1, opacity
  });
  marker.bindPopup(createFirePopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildNifcMarker(feature) {
  const props = feature.properties;
  const group = layerGroups['Wildfire Incident'];
  if (!group || !feature.geometry) return;

  const color = safeColor(props.color, '#D84315');
  const c = feature.geometry.coordinates;
  const ac = parseFloat(props.acres) || 0;
  const radius = ac >= 5000 ? 11 : ac >= 1000 ? 9 : ac >= 100 ? 7 : 5;

  const marker = L.circleMarker([c[1], c[0]], {
    radius, fillColor: color, fillOpacity: 0.85, color: '#fff', weight: 2
  });
  marker.bindPopup(createNifcPopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildVolcanoMarker(feature) {
  const props = feature.properties;
  const group = layerGroups['Volcano'];
  if (!group || !feature.geometry) return;

  const color = safeColor(props.color, '#E65100');
  const c = feature.geometry.coordinates;

  const marker = L.circleMarker([c[1], c[0]], {
    radius: 9, fillColor: color, fillOpacity: 0.9, color: '#311B92', weight: 2.5
  });
  marker.bindPopup(createVolcanoPopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildQuakeMarker(feature) {
  const props = feature.properties;
  const group = layerGroups['Earthquake'];
  if (!group || !feature.geometry) return;

  const color = props.color || '#6D4C41';
  const c = feature.geometry.coordinates;
  const mag = parseFloat(props.mag) || 0;
  const radius = mag >= 6 ? 12 : mag >= 5 ? 10 : mag >= 3 ? 7 : mag >= 1.5 ? 4 : 3;
  const opacity = severityOpacity(props.severity);

  const marker = L.circleMarker([c[1], c[0]], {
    radius, fillColor: color, fillOpacity: opacity,
    color: '#fff', weight: mag >= 4 ? 2.5 : 1.5, opacity
  });
  marker.bindPopup(createQuakePopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildFemaMarker(feature) {
  const props = feature.properties;
  const group = layerGroups[props.category];
  if (!group || !feature.geometry) return;

  const color = props.color || '#B71C1C';
  let layer;

  if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
    layer = L.geoJSON(feature, {
      style: { fillColor: color, fillOpacity: 0.3, color, weight: 3, opacity: 0.9 }
    });
  } else if (feature.geometry.type === 'Point') {
    const c = feature.geometry.coordinates;
    layer = L.circleMarker([c[1], c[0]], {
      radius: 9, fillColor: color, fillOpacity: 0.9, color: '#fff', weight: 2.5
    });
  } else return;

  layer.bindPopup(createFemaPopup(props), { maxWidth: 350, maxHeight: 400 });
  layer.addTo(group);
}

function buildDispatchMarker(feature) {
  const props = feature.properties;
  const group = layerGroups[props.category];
  if (!group || !feature.geometry) return;

  const color = props.color || DISPATCH_COLORS[props.category] || '#546E7A';
  const c = feature.geometry.coordinates;
  const opacity = severityOpacity(props.severity);
  const size = props.severity === 'Extreme' ? 9 : 7;

  const marker = L.circleMarker([c[1], c[0]], {
    radius: size, fillColor: color, fillOpacity: opacity,
    color: '#fff', weight: 2, opacity
  });
  marker.bindPopup(createDispatchPopup(props), { maxWidth: 350, maxHeight: 400 });
  marker.addTo(group);
}

function buildTornadoReportMarker(feature) {
  const props = feature.properties;
  const group = layerGroups['Tornado Report'];
  if (!group || !feature.geometry) return;

  const c = feature.geometry.coordinates;
  const color = props.color || '#0D47A1';
  const opacity = severityOpacity(props.severity);
  const size = props.severity === 'Extreme' ? 11 : 9;

  const marker = L.circleMarker([c[1], c[0]], {
    radius: size, fillColor: color, fillOpacity: opacity,
    color: '#fff', weight: 2, opacity
  });
  marker.bindPopup(createTornadoReportPopup(props), { maxWidth: 400, maxHeight: 500 });
  marker.addTo(group);
}

// ===================== POPUPS =====================

function popupFooter(props) {
  const parts = [];
  if (props.sourceUrl)
    parts.push(`<p><a href="${esc(props.sourceUrl)}" target="_blank" rel="noopener">More info</a></p>`);
  if (props.scannerUrl)
    parts.push(`<p class="scanner-link"><a href="${esc(props.scannerUrl)}" target="_blank" rel="noopener">&#x266B; Listen to area scanners</a></p>`);
  return parts.join('');
}

function createWeatherPopup(props) {
  const color = safeColor(props.color);
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">${esc(props.event)}</div>
    <h3>${esc(props.headline || props.event)}</h3>
    <p><strong>Severity:</strong> ${esc(props.severity || 'Unknown')}</p>
    <p><strong>Area:</strong> ${esc(props.areaDesc || 'N/A')}</p>
    ${props.expires ? `<p><strong>Expires:</strong> ${new Date(props.expires).toLocaleString()}</p>` : ''}
    ${props.description ? `<p style="margin-top:0.5rem;font-size:0.85rem;">${esc(props.description.substring(0, 300))}${props.description.length > 300 ? '...' : ''}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createGdeltPopup(props) {
  const color = safeColor(props.color);
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">${esc(props.event)}</div>
    <h3>${esc(props.headline || props.event)}</h3>
    <p><strong>Source:</strong> GDELT (news-derived)</p>
    <p><strong>Area:</strong> ${esc(props.areaDesc || 'N/A')}</p>
    ${popupFooter(props)}
  </div>`;
}

function createFirePopup(props) {
  const color = safeColor(props.color, '#FF8F00');
  const basisLabel = props.basis === 'nifc-confirmed'
    ? 'Confirmed by NIFC incident'
    : props.basis === 'high-intensity' ? 'High-intensity detection' : null;
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">Active Fire (NASA)</div>
    <h3>${esc(props.headline || 'Active Fire')}</h3>
    <p><strong>FRP:</strong> ${esc(props.frp || 'N/A')} MW</p>
    <p><strong>Confidence:</strong> ${esc(props.confidence || 'N/A')}</p>
    ${basisLabel ? `<p><strong>Basis:</strong> ${basisLabel}</p>` : ''}
    ${props.description ? `<p style="font-size:0.85rem;">${esc(props.description)}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createNifcPopup(props) {
  const color = safeColor(props.color, '#D84315');
  const acres = parseFloat(props.acres);
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">Wildfire Incident (NIFC)</div>
    <h3>${esc(props.headline || 'Wildfire')}</h3>
    <p><strong>Size:</strong> ${isNaN(acres) || !acres ? 'Unknown' : acres.toLocaleString() + ' acres'}</p>
    <p><strong>Containment:</strong> ${esc(props.contained || 'Unknown')}</p>
    <p><strong>Cause:</strong> ${esc(props.cause || 'Unknown')}</p>
    ${props.areaDesc ? `<p><strong>State:</strong> ${esc(props.areaDesc)}</p>` : ''}
    ${props.discovered ? `<p><strong>Discovered:</strong> ${new Date(props.discovered).toLocaleDateString()}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createVolcanoPopup(props) {
  const color = safeColor(props.color, '#E65100');
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">Volcano — ${esc(props.colorCode || '')}</div>
    <h3>${esc(props.headline || 'Volcano')}</h3>
    <p><strong>Alert level:</strong> ${esc(props.alertLevel || 'Unknown')}</p>
    ${props.areaDesc ? `<p><strong>Region:</strong> ${esc(props.areaDesc)}</p>` : ''}
    ${props.description ? `<p style="margin-top:0.5rem;font-size:0.85rem;">${esc(props.description.substring(0, 300))}${props.description.length > 300 ? '...' : ''}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createQuakePopup(props) {
  const color = safeColor(props.color, '#6D4C41');
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">Earthquake</div>
    <h3>${esc(props.headline || 'Earthquake')}</h3>
    <p><strong>Magnitude:</strong> ${esc(props.mag || 'N/A')}</p>
    <p><strong>Depth:</strong> ${esc(props.depth || 'N/A')} km</p>
    ${props.description ? `<p style="font-size:0.85rem;">${esc(props.description)}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createFemaPopup(props) {
  const color = safeColor(props.color, '#B71C1C');
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">${esc(props.femaEvent || props.event)}</div>
    <h3>${esc(props.headline || props.femaEvent || 'FEMA Alert')}</h3>
    <p><strong>From:</strong> ${esc(props.senderName || 'FEMA IPAWS')}</p>
    <p><strong>Severity:</strong> ${esc(props.severity || 'Unknown')} | <strong>Urgency:</strong> ${esc(props.urgency || 'Unknown')}</p>
    ${props.areaDesc ? `<p><strong>Area:</strong> ${esc(props.areaDesc)}</p>` : ''}
    ${props.description ? `<p style="margin-top:0.5rem;font-size:0.85rem;">${esc(props.description.substring(0, 400))}${props.description.length > 400 ? '...' : ''}</p>` : ''}
    ${props.instruction ? `<p style="margin-top:0.5rem;font-size:0.85rem;color:#1565C0;"><strong>Action:</strong> ${esc(props.instruction.substring(0, 300))}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createDispatchPopup(props) {
  const color = safeColor(props.color, '#546E7A');
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">${esc(props.category || 'Dispatch')}</div>
    <h3>${esc(props.dispatchType || props.event)}</h3>
    <p><strong>Source:</strong> 911 — ${esc(props.city || 'Unknown')}</p>
    ${props.areaDesc ? `<p><strong>Location:</strong> ${esc(props.areaDesc)}</p>` : ''}
    ${props.timestamp ? `<p><strong>Time:</strong> ${new Date(parseInt(props.timestamp)).toLocaleString()}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

function createTornadoReportPopup(props) {
  const color = safeColor(props.color, '#0D47A1');
  return `<div>
    <div class="alert-badge" style="background-color: ${color};">Tornado Report</div>
    <h3>${esc(props.efScale || 'Tornado')} — ${esc(props.areaDesc || 'Unknown')}</h3>
    ${props.efScale ? `<p><strong>Rating:</strong> ${esc(props.efScale)}</p>` : ''}
    ${props.timestamp ? `<p><strong>Time:</strong> ${new Date(parseInt(props.timestamp)).toLocaleString()}</p>` : ''}
    ${props.description ? `<p style="font-size:0.85rem;margin-top:0.5rem;">${esc(props.description.substring(0, 400))}</p>` : ''}
    ${popupFooter(props)}
  </div>`;
}

// ===================== STATUS COUNTS =====================
//
// notifyStatusDirty()  — single entry point, called by anything that changes visible events
// _recomputeCounts()   — one pass over allData for the current viewport
// _renderStatusBar()   — updates headline + dropdown (skips DOM if panel closed)

let _statusCounts = null;
let _statusTimer = null;

function notifyStatusDirty() {
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    _statusCounts = _recomputeCounts();
    _renderStatusBar();
  }, 150);
}

// Returns a lat/lng for a feature, or null if geometry is unsupported
function featureLatLng(feature) {
  if (feature._centroid) return feature._centroid;
  const geom = feature.geometry;
  let result = null;
  if (geom.type === 'Point') {
    result = [geom.coordinates[1], geom.coordinates[0]];
  } else if ((geom.type === 'Polygon' || geom.type === 'MultiPolygon') && geom.coordinates[0]) {
    const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    if (ring && ring.length) {
      result = [
        ring.reduce((s, c) => s + c[1], 0) / ring.length,
        ring.reduce((s, c) => s + c[0], 0) / ring.length
      ];
    }
  }
  feature._centroid = result;
  return result;
}

function _recomputeCounts() {
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const counts = {};
  let onScreen = 0;
  let zoomHidden = false;

  const enabledTypes = new Set();
  DATA_TYPES.forEach(t => {
    counts[t] = 0;
    if (getCheckbox(t)?.checked !== false) enabledTypes.add(t);
  });

  for (const feature of allData.features) {
    if (!passesTimeFilter(feature)) continue;
    if (!feature.geometry) continue;

    const type = feature.properties.category || feature.properties.event;
    if (!type || !enabledTypes.has(type)) continue;

    const latlng = featureLatLng(feature);
    if (!latlng || !bounds.contains(latlng)) continue;

    if (passesZoomFilter(feature, zoom)) {
      counts[type]++;
      onScreen++;
    } else {
      zoomHidden = true;
    }
  }
  return { counts, onScreen, zoomHidden };
}

function _renderStatusBar() {
  if (!_statusCounts) return;
  const { counts, onScreen, zoomHidden } = _statusCounts;

  const countEl = document.getElementById('alert-count');
  countEl.textContent = zoomHidden
    ? `${onScreen} events on screen \u00B7 zoom in for more`
    : `${onScreen} events on screen`;
  countEl.style.color = onScreen > 0 ? '#4CAF50' : '#aaa';

  const panel = document.getElementById('status-panel');
  if (!panel.classList.contains('hidden')) _renderStatusList(counts);
}

function _renderStatusList(counts) {
  const list = document.getElementById('status-list');
  const search = (document.getElementById('status-search').value || '').toLowerCase();
  let html = '';

  for (const [, group] of Object.entries(LAYER_GROUPS)) {
    const rows = group.types
      .filter(t => t.toLowerCase().includes(search))
      .map(t => {
        const c = counts[t] || 0;
        const color = TYPE_COLORS[t] || '#888';
        return `<div class="status-row">
          <span class="status-row-label"><span class="status-row-dot" style="background:${color}"></span>${t}</span>
          <span class="status-row-count${c === 0 ? ' zero' : ''}">${c}</span>
        </div>`;
      });
    if (!rows.length) continue;
    html += `<div class="status-group-header">${group.label}</div>${rows.join('')}`;
  }

  // Source freshness — flag stale sources (>2x their normal refresh interval)
  if (!search && allData.meta) {
    const STALE_THRESHOLDS = { alert: 30, quake: 10, fire: 360, gdelt: 30, fema: 30, dispatch: 20, spc: 30 };
    let freshHtml = '<div class="status-group-header">Source Freshness</div>';
    for (const [prefix, m] of Object.entries(allData.meta)) {
      if (prefix === 'timeBounds' || !m.lastUpdate) continue;
      const ago = Math.round((Date.now() - new Date(m.lastUpdate).getTime()) / 60000);
      const threshold = STALE_THRESHOLDS[prefix] || 30;
      const stale = ago > threshold * 2;
      const label = m.source || prefix;
      const agoText = ago < 1 ? '<1m ago' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
      freshHtml += `<div class="status-row">
        <span class="status-row-label">${esc(label)}</span>
        <span class="status-row-count${stale ? ' stale' : ''}">${agoText}</span>
      </div>`;
    }
    html += freshHtml;
  }

  list.innerHTML = html || '<div class="status-row"><span class="status-row-label" style="color:var(--text-dim)">No matching categories</span></div>';
}

function toggleStatusPanel() {
  const panel = document.getElementById('status-panel');
  const status = document.getElementById('status');
  panel.classList.toggle('hidden');
  status.classList.toggle('open');
  if (!panel.classList.contains('hidden')) {
    document.getElementById('status-search').value = '';
    if (_statusCounts) _renderStatusList(_statusCounts.counts);
    else notifyStatusDirty();
    document.getElementById('status-search').focus();
  }
}

document.addEventListener('click', (e) => {
  const status = document.getElementById('status');
  const panel = document.getElementById('status-panel');
  if (!status.contains(e.target) && !panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    status.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('status-search');
  if (search) search.addEventListener('input', () => {
    if (_statusCounts) _renderStatusList(_statusCounts.counts);
  });
});

// ===================== PRESETS =====================

function applyPreset(preset) {
  const presets = {
    all:      { weather: true, tropical: true, earthquake: true, wildfire: true, volcano: true, emergency: true, dispatch: true, conflict: true },
    weather:  { weather: true, tropical: true, earthquake: false, wildfire: false, volcano: false, emergency: false, dispatch: false, conflict: false },
    seismic:  { weather: false, tropical: false, earthquake: true, wildfire: false, volcano: true, emergency: false, dispatch: false, conflict: false },
    fire:     { weather: false, tropical: false, earthquake: false, wildfire: true, volcano: false, emergency: false, dispatch: false, conflict: false },
    conflict: { weather: false, tropical: false, earthquake: false, wildfire: false, volcano: false, emergency: true, dispatch: true, conflict: true },
  };

  if (preset === 'critical') {
    DATA_TYPES.forEach(type => { const cb = getCheckbox(type); if (cb) cb.checked = false; });
    ['Tornado Warning', 'Tornado Report', 'Hurricane Warning', 'Storm Surge Warning', 'Tsunami Warning',
     'Earthquake', 'Official Alerts', 'Missing Persons', 'Armed Violence',
     'Wildfire', 'Wildfire Incident', 'Volcano', 'Red Flag Warning', 'Dispatch Fire', 'Dispatch Violence', 'Dispatch Hazmat'
    ].forEach(type => { const cb = getCheckbox(type); if (cb) cb.checked = true; });
  } else {
    const config = presets[preset];
    if (!config) return;
    Object.entries(LAYER_GROUPS).forEach(([key, group]) => {
      const on = config[key];
      group.types.forEach(type => { const cb = getCheckbox(type); if (cb) cb.checked = on; });
      const gcb = getGroupCheckbox(key);
      if (gcb) gcb.checked = on;
    });
  }

  Object.keys(LAYER_GROUPS).forEach(updateGroupCheckbox);
  syncLayerVisibility();
  notifyStatusDirty();

  const satOn = preset === 'all';
  ['sat-ir', 'sat-vis', 'sat-wv', 'radar'].forEach(id => {
    const cb = getSatCheckbox(id);
    if (cb) cb.checked = satOn;
  });
  syncSatelliteVisibility();
}

// ===================== CONTROLS =====================

const REFRESH_COOLDOWN = 60;
let refreshCooldownTimer = null;

async function refreshAlerts() {
  const btn = document.getElementById('refresh-btn');
  if (btn.disabled) return;

  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    await fetch(`${API_URL}/fetch`, { method: 'POST' });
    await new Promise(r => setTimeout(r, 1500));
    await loadAll();
  } catch (e) { console.error('Refresh error:', e); }

  let remaining = REFRESH_COOLDOWN;
  btn.textContent = `\u21bb ${remaining}s`;
  refreshCooldownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(refreshCooldownTimer);
      btn.disabled = false;
      btn.textContent = '\u21bb Refresh';
    } else {
      btn.textContent = `\u21bb ${remaining}s`;
    }
  }, 1000);
}

function centerOnUS() { map.setView([39.8283, -98.5795], 4); }

function togglePanel() {
  document.getElementById('legend').classList.toggle('hidden');
  document.getElementById('toggle-panel-btn').classList.toggle('panel-hidden');
}

// ===================== LOCAL WEATHER =====================

let weatherData = null;

async function loadWeather() {
  try {
    const res = await fetch(`${API_URL}/weather`);
    if (!res.ok) return;
    weatherData = await res.json();
    const btn = document.getElementById('weather-btn');
    if (btn && weatherData.current) {
      const c = weatherData.current;
      btn.textContent = `${c.tempF}°F `;
      const cond = document.createElement('span');
      cond.className = 'weather-condition';
      cond.textContent = c.condition;
      btn.appendChild(cond);
      btn.title = `${weatherData.location} — Feels like ${c.feelsLikeF}°F, Wind ${c.windMph} mph ${c.windDir}`;
    }
  } catch (_) {}
}

function toggleWeather() {
  const panel = document.getElementById('weather-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden') && weatherData) renderWeatherPanel();
}

function renderWeatherPanel() {
  const el = document.getElementById('weather-content');
  if (!el || !weatherData) return;
  const c = weatherData.current;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const forecastHtml = weatherData.forecast.map(day => {
    const label = days[new Date(day.date + 'T12:00:00').getDay()];
    return `<div class="forecast-day">
      <span class="forecast-label">${esc(label)}</span>
      <span class="forecast-temps">${esc(day.highF)}° / ${esc(day.lowF)}°</span>
      <span class="forecast-cond">${esc(day.condition)}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="weather-current">
      <div class="weather-location">${esc(weatherData.location)}</div>
      <div class="weather-temp">${esc(c.tempF)}°F</div>
      <div class="weather-detail">${esc(c.condition)} — Feels like ${esc(c.feelsLikeF)}°F</div>
      <div class="weather-detail">Humidity ${esc(c.humidity)}% — Wind ${esc(c.windMph)} mph ${esc(c.windDir)}</div>
    </div>
    <div class="weather-forecast">${forecastHtml}</div>
  `;
}

setInterval(loadWeather, 30 * 60 * 1000);

// ===================== HOME BASE PIN =====================

async function loadHomePin() {
  try {
    const res = await fetch(`${API_URL}/location`);
    if (!res.ok) return;
    const loc = await res.json();
    if (!loc.lat || !loc.lon) return;

    const marker = L.marker([loc.lat, loc.lon], {
      icon: L.divIcon({
        className: 'home-pin',
        html: '<div class="home-pin-inner"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9]
      }),
      zIndexOffset: 1000, interactive: true
    }).addTo(map);

    const scannerHtml = loc.scannerUrl
      ? `<p class="scanner-link"><a href="${esc(loc.scannerUrl)}" target="_blank" rel="noopener">&#x266B; Listen to area scanners</a></p>`
      : '';
    marker.bindPopup(`<div class="popup"><strong>${esc(loc.label)}</strong><br><span style="color:#888;font-size:0.85rem;">Home Base</span>${scannerHtml}</div>`);
  } catch (_) {}
}

// ===================== BOOT =====================

setInterval(loadAll, 5 * 60 * 1000);

loadRadarLayer().then(() => {
  syncLayerVisibility();
  syncSatelliteVisibility();
  loadAll();
  loadHomePin();
  loadWeather();
});
