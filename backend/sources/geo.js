/**
 * Geography lookups shared by the alert sources: state FIPS codes, state
 * centroids, and the bundled NOAA UGC county centroids used when an alert
 * carries SAME/FIPS codes but no polygon.
 *
 * SAME code format: 0SSCCC — leading 0, 2-digit state FIPS, 3-digit county
 * FIPS. County 000 means statewide.
 */

const fs = require('fs');
const path = require('path');

const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
  '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
  '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
  '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
  '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
  '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
  '55':'WI','56':'WY'
};

// Inverse: state abbreviation → FIPS (Broadcastify's state-level ids).
const STATE_FIPS = Object.fromEntries(Object.entries(FIPS_TO_STATE).map(([f, s]) => [s, f]));

// [lat, lon] — for statewide alerts (county 000) and unknown counties.
const STATE_CENTROIDS = {
  'AL':[32.8,-86.8],'AK':[64.2,-152.5],'AZ':[34.0,-111.1],'AR':[34.8,-92.2],
  'CA':[36.8,-119.4],'CO':[39.0,-105.5],'CT':[41.6,-72.7],'DE':[39.0,-75.5],
  'DC':[38.9,-77.0],'FL':[27.8,-81.7],'GA':[32.7,-83.5],'HI':[19.9,-155.6],
  'ID':[44.1,-114.7],'IL':[40.3,-89.0],'IN':[40.3,-86.1],'IA':[42.0,-93.2],
  'KS':[38.5,-98.0],'KY':[37.8,-84.3],'LA':[30.5,-91.2],'ME':[45.3,-69.4],
  'MD':[39.0,-76.6],'MA':[42.4,-71.4],'MI':[44.3,-85.6],'MN':[46.4,-94.6],
  'MS':[32.7,-89.7],'MO':[38.5,-92.3],'MT':[46.8,-110.4],'NE':[41.1,-98.3],
  'NV':[38.8,-116.4],'NH':[43.2,-71.6],'NJ':[40.1,-74.5],'NM':[34.0,-105.9],
  'NY':[43.0,-75.5],'NC':[35.8,-79.0],'ND':[47.5,-100.5],'OH':[40.4,-82.9],
  'OK':[35.0,-97.1],'OR':[43.8,-120.6],'PA':[41.2,-77.2],'RI':[41.6,-71.5],
  'SC':[34.0,-81.0],'SD':[43.9,-99.9],'TN':[35.5,-86.0],'TX':[31.0,-100.0],
  'UT':[39.3,-111.1],'VT':[44.0,-72.7],'VA':[37.8,-78.2],'WA':[47.4,-120.7],
  'WV':[38.5,-80.5],'WI':[43.8,-89.5],'WY':[43.1,-107.6]
};

// UGC county centroids ("INC097" → [lat, lon]), bundled from NOAA zone data.
let ugcCentroids = {};
try {
  ugcCentroids = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ugc_centroids.json'), 'utf-8'));
} catch (_) {}

/**
 * One SAME code → GeoJSON Point: county centroid, else the state centroid,
 * else null (unknown state or malformed code).
 */
function sameCodeToPoint(code) {
  if (!code || String(code).length !== 6) return null;
  const state = FIPS_TO_STATE[String(code).slice(1, 3)];
  if (!state) return null;

  const countyFips = String(code).slice(3, 6);
  if (countyFips !== '000') {
    const coords = ugcCentroids[`${state}C${countyFips}`];
    if (coords) return { type: 'Point', coordinates: [coords[1], coords[0]] };
  }
  const stateCoords = STATE_CENTROIDS[state];
  return stateCoords ? { type: 'Point', coordinates: [stateCoords[1], stateCoords[0]] } : null;
}

/** First resolvable code in a list, or null. */
function sameCodesToPoint(codes) {
  for (const code of codes || []) {
    const pt = sameCodeToPoint(code);
    if (pt) return pt;
  }
  return null;
}

module.exports = { FIPS_TO_STATE, STATE_FIPS, STATE_CENTROIDS, sameCodeToPoint, sameCodesToPoint };
