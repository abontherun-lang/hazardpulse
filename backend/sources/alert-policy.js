/**
 * Which NWS alerts reach the map — decided once, here, for both feeds.
 *
 * Before 2026-09-08 noaa.js kept a hand list of 21 event names and fema.js
 * kept a second hand list of weather events to skip "because NOAA covers
 * them". The two disagreed: Flash Flood Warning was on neither, so the
 * deadliest flood product reached no layer, and Extreme Heat Warning, High
 * Wind Warning and Freeze Warning were dropped while Small Craft Advisory
 * was correctly ignored.
 *
 * The rule: every NWS *Warning* is shown except marine products; watches,
 * advisories and statements are shown only from the allow-list below.
 * fema.js skips IPAWS messages whose sender is the NWS, since those are the
 * same alerts on a slower archive; everything else in IPAWS is a local
 * authority the NWS feed does not carry.
 *
 * Types with a layers.json entry get their own legend row; any other kept
 * event lands in the FALLBACK_TYPE row instead of vanishing.
 */

const { has } = require('../layers');

const FALLBACK_TYPE = 'Other NWS Alert';

// Marine and open-water products. "Storm Warning" (exact) is the marine
// gale-force product, not a land storm.
const MARINE_RE = /\b(Small Craft|Gale|Hazardous Seas|Marine|Surf|Rip Current|Lake Wind|Beach Hazards|Freezing Spray|Brisk Wind|Low Water|Hurricane Force Wind)\b/i;
const MARINE_EXACT = new Set(['Storm Warning', 'Storm Watch']);

// Never a hazard.
const NEVER = new Set(['Test Message', 'Administrative Message']);

// Watches, advisories, statements and emergencies that earn a layer.
// Warnings are not listed: they are all kept unless marine.
const ALLOW = new Set([
  'Tornado Watch', 'Severe Thunderstorm Watch', 'Flood Watch',
  'Hurricane Watch', 'Typhoon Watch', 'Tropical Storm Watch', 'Storm Surge Watch',
  'Hurricane Local Statement', 'Tropical Cyclone Local Statement',
  'Tsunami Watch', 'Tsunami Advisory',
  'Fire Weather Watch',
  'Extreme Heat Watch', 'Heat Advisory',
  'Extreme Cold Watch', 'Cold Weather Advisory',
  'Winter Storm Watch', 'Winter Weather Advisory',
  'Wind Advisory',
  'Ashfall Advisory',
  'Special Weather Statement',
  'Evacuation Immediate', 'Civil Emergency Message', 'Local Area Emergency',
  'Child Abduction Emergency', '911 Telephone Outage Emergency'
]);

/**
 * @param {object} props — NWS alert properties (event, severity, status, messageType)
 * @returns {boolean}
 */
function keepAlert(props) {
  const event = (props && props.event) || '';
  if (!event || NEVER.has(event)) return false;
  if (props.status && props.status !== 'Actual') return false;
  if (props.messageType === 'Cancel') return false;
  if (MARINE_EXACT.has(event) || MARINE_RE.test(event)) return false;
  if (ALLOW.has(event)) return true;
  return /\bWarning$/.test(event);
}

/** The legend type (category) a kept event is stored under. */
function categoryFor(event) {
  return has(event) ? event : FALLBACK_TYPE;
}

module.exports = { keepAlert, categoryFor, ALLOW, NEVER, MARINE_RE, MARINE_EXACT, FALLBACK_TYPE };
