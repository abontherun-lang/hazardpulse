const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isActiveWF, severity } = require('../sources/nifc');
const { isElevated } = require('../sources/volcano');

const NOW = 1789000000000;
const DAY = 86400000;

test('an incident is active when it is a wildfire, not out, and uncontained or recent', () => {
  assert.equal(isActiveWF({ IncidentTypeCategory: 'WF', PercentContained: 40 }, NOW), true);
  assert.equal(isActiveWF({ IncidentTypeCategory: 'WF', PercentContained: 100, FireDiscoveryDateTime: NOW - 3 * DAY }, NOW), true);   // contained but recent
  assert.equal(isActiveWF({ IncidentTypeCategory: 'WF', PercentContained: 100, FireDiscoveryDateTime: NOW - 40 * DAY }, NOW), false); // contained and old
  assert.equal(isActiveWF({ IncidentTypeCategory: 'WF', PercentContained: null }, NOW), true);                                        // unknown containment
  assert.equal(isActiveWF({ IncidentTypeCategory: 'WF', PercentContained: 10, FireOutDateTime: NOW - DAY }, NOW), false);            // declared out
  assert.equal(isActiveWF({ IncidentTypeCategory: 'RX', PercentContained: 0 }, NOW), false);                                          // prescribed burn
});

test('NIFC severity bands by acreage', () => {
  assert.equal(severity(10).level, 'Low');
  assert.equal(severity(100).level, 'Moderate');
  assert.equal(severity(1000).level, 'Severe');
  assert.equal(severity(5000).level, 'Extreme');
});

test('a volcano is elevated when above NORMAL/GREEN with a real color code', () => {
  assert.equal(isElevated({ alertLevel: 'WATCH', colorCode: 'ORANGE' }), true);
  assert.equal(isElevated({ alertLevel: 'ADVISORY', colorCode: 'YELLOW' }), true);
  assert.equal(isElevated({ alertLevel: 'NORMAL', colorCode: 'GREEN' }), false);
  assert.equal(isElevated({ alertLevel: 'UNASSIGNED', colorCode: '' }), false);
  assert.equal(isElevated({ alertLevel: 'WATCH', colorCode: 'GREEN' }), false);
  assert.equal(isElevated({}), false);
});
