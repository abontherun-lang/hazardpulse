# US Government Crisis Data APIs — Research Results

Researched 2026-03-29. All endpoints tested with curl. Excludes sources you already have (NOAA Weather, USGS Earthquake, NASA FIRMS).

---

## TIER 1 - HIGH VALUE (Working, structured, real-time, geographic)

### 1. FEMA IPAWS Archived Alerts
**The single best source found.** Contains ALL emergency alerts sent through the Integrated Public Alert and Warning System -- AMBER alerts, law enforcement warnings, evacuations, fire warnings, civil emergencies, missing persons, tornado/flash flood warnings (beyond NWS), and more.

- **Data:** Emergency alerts from ~1,500+ local/state/federal agencies. Includes AMBER alerts, law enforcement warnings, evacuation orders, fire warnings, civil emergencies, missing persons, hazmat, etc.
- **Endpoint:** `https://www.fema.gov/api/open/v1/IpawsArchivedAlerts?$top=100&$orderby=sent%20desc`
- **Format:** JSON with embedded CAP (Common Alerting Protocol) structure
- **API Key:** None required
- **Update Frequency:** Near real-time (alerts appear within minutes of being sent)
- **Geographic Granularity:** Polygon coordinates, circle+radius, or FIPS county codes in each alert
- **Status:** VERIFIED WORKING. Returned real alerts including LAPD protest dispersal order and TX DOT collision with polygon geometry.
- **Event types observed:** Child Abduction Emergency, Civil Emergency Message, Evacuation Immediate, Fire Warning, Flash Flood Warning, Law Enforcement Warning, Local Area Emergency, Missing and Endangered Persons, Severe Thunderstorm Warning, Tornado Warning, SAFE Alert Activation
- **OData query support:** $filter, $orderby, $top, $skip, $select
- **Note:** This is a superset that covers AMBER alerts, many local law enforcement alerts, and much more. This single source replaces the need for separate AMBER, missing persons, and local emergency feeds.

### 2. FEMA Disaster Declarations
- **Data:** Federally declared disasters -- fires, hurricanes, floods, severe storms, etc. with FIPS county codes, incident types, dates, and program eligibility.
- **Endpoint:** `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=50&$orderby=declarationDate%20desc`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** Within hours of presidential declaration
- **Geographic Granularity:** State + FIPS county code
- **Status:** VERIFIED WORKING. Most recent: Jumping Juniper Fire (OK), 2026-03-22.

### 3. FEMA Mission Assignments
- **Data:** Federal agency tasking for disaster response -- which agencies are deployed where, priority levels, costs.
- **Endpoint:** `https://www.fema.gov/api/open/v2/MissionAssignments?$top=50`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** As missions are assigned during active disasters
- **Geographic Granularity:** State abbreviation
- **Status:** VERIFIED WORKING. Shows active disaster response operations with agency assignments.

### 4. FEMA Public Assistance Funded Projects
- **Data:** Active disaster relief projects with county-level detail, project amounts, damage categories.
- **Endpoint:** `https://www.fema.gov/api/open/v2/PublicAssistanceFundedProjectsDetails?$top=50&$orderby=declarationDate%20desc`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** As projects are obligated
- **Geographic Granularity:** State + county name + county code
- **Status:** VERIFIED WORKING. Most recent: Winter Storm relief in MS, obligated 2026-03-12.

### 5. NIFC Wildfire Incident Locations (Active Fires)
- **Data:** Current wildfire incident points from the National Interagency Fire Center -- fire name, size, containment %, cause, discovery date, coordinates.
- **Endpoint:** `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=IncidentTypeCategory%3D%27WF%27&outFields=IncidentName,InitialLatitude,InitialLongitude,IncidentSize,FireDiscoveryDateTime,PercentContained,GACC,POOState&f=geojson&orderByFields=FireDiscoveryDateTime%20DESC&resultRecordCount=500`
- **Format:** GeoJSON (also supports JSON)
- **API Key:** None required
- **Update Frequency:** Multiple times daily
- **Geographic Granularity:** Lat/lon point per incident
- **Status:** VERIFIED WORKING. Returned active wildfires in CA and other states with coordinates.
- **Note:** Complements NASA FIRMS (satellite hotspots) with official incident data (names, containment, management info).

### 6. NIFC Wildfire Perimeters (Active Fire Boundaries)
- **Data:** Current wildfire perimeter polygons -- fire boundaries, acreage, name, management info.
- **Endpoint:** `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500`
- **Format:** GeoJSON
- **API Key:** None required
- **Update Frequency:** Daily (perimeters updated from InFORM)
- **Geographic Granularity:** Polygon boundaries of each fire
- **Status:** VERIFIED WORKING. Returned Foster Bridge fire perimeter (670 acres, FL) with full polygon geometry.

### 7. FAA Airport Status / Delays / Closures
- **Data:** Real-time ground delays, departure/arrival delays, and airport closures across the US. Includes delay reasons (weather, traffic management, etc.).
- **Endpoint:** `https://nasstatus.faa.gov/api/airport-status-information`
- **Format:** XML
- **API Key:** None required
- **Update Frequency:** Real-time (minutes)
- **Geographic Granularity:** Airport code (3-letter IATA)
- **Status:** VERIFIED WORKING. Returned active ground delay at LGA, departure delays at JFK/MIA/SEA, closures at STX/SAN/LAS.
- **Note:** XML only, no JSON option. Will need an XML parser (e.g., `fast-xml-parser` for Node.js).

### 8. NOAA/NWS River Gauge Flood Status
- **Data:** Real-time river gauge levels with flood category assessment (no_flooding, action, minor, moderate, major). Includes 12,600+ gauges nationwide.
- **Endpoint:** `https://api.water.noaa.gov/nwps/v1/gauges?stateCd={STATE}&siteType=obs&limit=500`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** Real-time (15-minute intervals at most gauges)
- **Geographic Granularity:** Lat/lon per gauge station
- **Status:** VERIFIED WORKING. Found 53 gauges in active flood status. Includes gauge name, lat/lon, observed level, flood category, forecast.
- **Note:** Must query state-by-state or build a full national scan. This extends beyond what the NOAA Weather API provides -- it gives actual water levels vs. flood stage.

### 9. USGS Water Services (Real-Time Stream Gauges)
- **Data:** Instantaneous stream gauge values for gage height, discharge, temperature. 793 active gauges in TX alone.
- **Endpoint:** `https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd={STATE}&parameterCd=00065&siteStatus=active&period=PT2H`
- **Format:** JSON (WaterML-like JSON wrapper)
- **API Key:** None required
- **Update Frequency:** Real-time (every 15 minutes)
- **Geographic Granularity:** Lat/lon per gauge site
- **Status:** VERIFIED WORKING. Parameter 00065 = gage height, 00060 = discharge.
- **Note:** Lower-level than the NWS gauge API above. More data but requires you to determine flood stage yourself.

### 10. CDC Respiratory Illness Syndromic Surveillance (Emergency Dept Visits)
- **Data:** Weekly COVID, influenza, and RSV emergency department visit percentages by county, with trend indicators (Increasing/Decreasing/No Change).
- **Endpoint:** `https://data.cdc.gov/resource/rdmq-nq56.json?$limit=1000&$where=week_end>'2026-03-01'&$order=week_end%20DESC`
- **Format:** JSON (Socrata SODA API)
- **API Key:** None required (app tokens recommended for higher rate limits -- free)
- **Update Frequency:** Weekly (every Friday)
- **Geographic Granularity:** County-level with FIPS codes
- **Status:** VERIFIED WORKING. Current data through 2026-03-21.
- **Socrata dataset ID:** rdmq-nq56

### 11. CDC NNDSS - Notifiable Diseases Weekly
- **Data:** Weekly case counts for nationally notifiable infectious diseases (anthrax, cholera, plague, rabies, Zika, etc.) by region/state. Includes geocode points.
- **Endpoint:** `https://data.cdc.gov/resource/x9gk-5huc.json?$limit=1000&$where=year='2026'&$order=week%20DESC`
- **Format:** JSON with embedded GeoJSON points per state
- **API Key:** None required
- **Update Frequency:** Weekly
- **Geographic Granularity:** State/region level with lat/lon centroid
- **Status:** VERIFIED WORKING. Current data through 2026 week 11.

### 12. CDC RESP-NET Hospitalization Rates
- **Data:** Weekly hospitalization rates for flu, COVID, RSV by age group, sex, race/ethnicity.
- **Endpoint:** `https://data.cdc.gov/resource/kvib-3txy.json?$limit=100&$order=week_ending_date%20DESC`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** Weekly
- **Geographic Granularity:** Surveillance site (multi-state network)
- **Status:** VERIFIED WORKING. Current data through 2026-03-21.

---

## TIER 2 - GOOD VALUE (Working but with limitations)

### 13. AirNow Air Quality (Bulk Data Files - No Key)
- **Data:** Current AQI observations for every monitoring station in the US. Includes PM2.5, PM10, ozone readings with AQI category (Good/Moderate/Unhealthy/etc.).
- **Endpoint (no key):** `https://files.airnowtech.org/airnow/today/reportingarea.dat`
- **Format:** Pipe-delimited text (|). ~6,500 records.
- **Columns:** Date|Date|Time|Timezone|Offset|DataType|Primary|City|State|Lat|Lon|Pollutant|AQI|Category|Action|Discussion|Agency
- **API Key:** Not needed for bulk files. JSON API at `https://www.airnowapi.org/aq/observation/latLong/current/` requires a free key from https://docs.airnowapi.org/account/request/
- **Update Frequency:** Hourly
- **Geographic Granularity:** Lat/lon per monitoring station
- **Status:** VERIFIED WORKING. 6,499 records returned.
- **Note:** Pipe-delimited, not JSON. Easy to parse but requires custom parser.

### 14. AirNow Hourly Data (Detailed - No Key)
- **Endpoint:** `https://files.airnowtech.org/airnow/today/HourlyData_{YYYYMMDDHH}.dat`
- **Format:** Pipe-delimited text
- **Status:** VERIFIED WORKING. Individual pollutant readings at station level.

### 15. NRC Nuclear Reactor Power Status
- **Data:** Daily power output percentage for every commercial nuclear reactor in the US. A reactor at 0% is shut down (could be routine maintenance or emergency).
- **Endpoint:** `https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/PowerReactorStatusForLast365Days.txt`
- **Format:** Pipe-delimited text (ReportDt|Unit|Power)
- **API Key:** None required
- **Update Frequency:** Daily
- **Geographic Granularity:** Plant name only (would need a lookup table for lat/lon)
- **Status:** VERIFIED WORKING. 34,416 lines. Shows all 93 US commercial reactors.
- **Note:** A reactor suddenly dropping to 0% could indicate an emergency scram. You would need to maintain a lookup table mapping plant names to coordinates.

### 16. USGS STN Flood Events
- **Data:** Documented flood events with high water marks and instrument deployments from the USGS Short-Term Network.
- **Endpoint:** `https://stn.wim.usgs.gov/STNServices/Events.json`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** As events occur (latest: 2026 March HI Flood)
- **Geographic Granularity:** Event-level (state)
- **Status:** VERIFIED WORKING. 332 events in database. Latest: 2026 March HI Flood.
- **Note:** More of a post-event documentation system than real-time alerting.

### 17. CDC COVID/Pneumonia/Influenza Mortality
- **Data:** Weekly death counts by state for COVID-19, pneumonia, influenza with expected death comparisons.
- **Endpoint:** `https://data.cdc.gov/resource/r8kw-7aab.json?$limit=100&$order=data_as_of%20DESC`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** Weekly
- **Geographic Granularity:** State level
- **Status:** VERIFIED WORKING. Data current as of 2026-03-26.

### 18. CDC Wastewater Surveillance
- **Data:** SARS-CoV-2 wastewater concentrations at treatment plants nationwide -- early indicator of community spread.
- **Endpoint:** `https://data.cdc.gov/resource/g653-rqe2.json?$limit=100&$order=date%20DESC`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** Weekly
- **Geographic Granularity:** Treatment plant level (keyed by plot ID)
- **Status:** VERIFIED WORKING. Latest data 2025-09-07 (may have lag).

### 19. CPSC Product Safety Recalls
- **Data:** Consumer product recalls with injury reports, descriptions, affected units.
- **Endpoint:** `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-03-01`
- **Format:** JSON
- **API Key:** None required
- **Update Frequency:** As recalls are issued (several per week)
- **Geographic Granularity:** National (no geographic specificity per recall)
- **Status:** VERIFIED WORKING. 29 recalls in March 2026.
- **Note:** Not geographically specific but relevant for crisis awareness.

### 20. EPA Envirofacts - Drinking Water Violations
- **Data:** Safe Drinking Water Act violations including MCL exceedances, by public water system.
- **Endpoint:** `https://data.epa.gov/efservice/VIOLATION/PRIMACY_AGENCY_CODE/{STATE}/ROWS/0:100/XML`
- **Format:** XML (also supports CSV via `/CSV` suffix)
- **API Key:** None required
- **Update Frequency:** Quarterly-ish (compliance period based)
- **Geographic Granularity:** Public water system ID (can be joined to get lat/lon)
- **Status:** VERIFIED WORKING. Returns violations with contaminant codes, compliance dates.
- **Note:** XML format only for the JSON-like endpoint. Not real-time but useful for background hazard mapping.

---

## TIER 3 - SUPPLEMENTARY / REFERENCE

### 21. FEMA Emergency Management Performance Grants
- **Endpoint:** `https://www.fema.gov/api/open/v2/EmergencyManagementPerformanceGrants?$top=50`
- **Status:** VERIFIED WORKING. Useful for understanding which states have emergency management capacity. Not real-time crisis data.

### 22. HIFLD Critical Infrastructure (Hospitals, Fire Stations, etc.)
- **Data:** Locations of hospitals, fire stations, EMS, schools, power plants.
- **Endpoint:** Various ArcGIS Feature Services at `https://services1.arcgis.com/Hp6G80Pky0om6HgQ/arcgis/rest/services/`
- **Status:** PARTIALLY WORKING. Some layers returned empty results; may need specific layer names. Useful as reference data for proximity analysis, not as an event feed.

---

## NOT AVAILABLE / DID NOT WORK

### DHS Threat Levels
- The old color-coded system was replaced by NTAS (National Terrorism Advisory System) bulletins. No structured API exists. Published as web pages only at https://www.dhs.gov/ntas.

### FBI/ATF Active Shooter Alerts
- No public structured feed exists. The FBI's active shooter resources are PDF reports and web pages only. FEMA IPAWS "Law Enforcement Warning" events are the closest equivalent.

### National Response Center (NRC - Coast Guard) Spill Reports
- Website at https://nrc.uscg.mil/ is an ASP.NET web application with no public API. Spill reports are entered via phone (1-800-424-8802) and only available through the web search interface. No structured data feed.

### NRC Nuclear Event Notification Reports
- The Nuclear Regulatory Commission publishes event notification reports as HTML pages, not structured data. The reactor power status file (Tier 2 #15) is the only machine-readable nuclear data available.

### Coast Guard Maritime Incidents
- No public structured feed. AIS vessel tracking data is available commercially but not via free government API.

### National Inventory of Dams
- API at `https://nid.sec.usace.army.mil/api/` returned "Invalid request format" for all tested endpoints. The data is available via interactive web map but not reliably via API.

### Dam Safety Warnings
- No national real-time dam failure warning feed exists. Dam-related emergencies would appear in FEMA IPAWS as "Civil Emergency Message" or "Evacuation Immediate" alerts.

### InciWeb (Interagency Wildfire)
- The `inciweb.wildfire.gov/api/incidents` endpoint returned 404. InciWeb appears to have been superseded by the NIFC ArcGIS services (Tier 1 #5 and #6) which contain the same data.

### EPA ECHO (Enforcement & Compliance)
- The ECHO API at `echo.epa.gov` appears to have been decommissioned or moved. Tested multiple endpoint variations; all returned errors or empty results. The `echodata.epa.gov` variant also failed.

---

## RECOMMENDED INTEGRATION PRIORITY

For HazardPulse, integrate in this order:

1. **FEMA IPAWS Archived Alerts** -- Covers the widest range of emergency types (AMBER, law enforcement, evacuations, hazmat, fire, weather, missing persons). Single endpoint, real-time, with geographic polygons.
2. **NIFC Wildfire Incidents + Perimeters** -- Official fire data with containment % and boundaries. Complements your NASA FIRMS satellite data.
3. **FAA Airport Status** -- Transportation disruptions in real-time.
4. **NOAA NWS River Gauge Flood Status** -- Active flooding with flood severity categories.
5. **FEMA Disaster Declarations** -- Federal disaster context for major events.
6. **AirNow Air Quality** -- Hourly AQI data, especially critical during wildfire smoke events.
7. **CDC Syndromic Surveillance** -- Weekly disease trends by county.
8. **NRC Nuclear Reactor Status** -- Daily reactor power levels as safety indicator.
9. **CDC NNDSS Disease Surveillance** -- Weekly notifiable disease counts.

---

## API SUMMARY TABLE

| Source | Endpoint | Format | Key? | Frequency | Geo |
|--------|----------|--------|------|-----------|-----|
| FEMA IPAWS | /api/open/v1/IpawsArchivedAlerts | JSON | No | Real-time | Polygon/Circle/FIPS |
| FEMA Disasters | /api/open/v2/DisasterDeclarationsSummaries | JSON | No | Hours | FIPS county |
| FEMA Missions | /api/open/v2/MissionAssignments | JSON | No | Hours | State |
| FEMA PA Projects | /api/open/v2/PublicAssistanceFundedProjectsDetails | JSON | No | Days | County |
| NIFC Fire Points | ArcGIS FeatureServer (see above) | GeoJSON | No | Hours | Lat/lon |
| NIFC Fire Perimeters | ArcGIS FeatureServer (see above) | GeoJSON | No | Daily | Polygon |
| FAA Airport Status | nasstatus.faa.gov/api/airport-status-information | XML | No | Minutes | Airport code |
| NOAA River Gauges | api.water.noaa.gov/nwps/v1/gauges | JSON | No | 15 min | Lat/lon |
| USGS Water Services | waterservices.usgs.gov/nwis/iv/ | JSON | No | 15 min | Lat/lon |
| AirNow (bulk) | files.airnowtech.org/airnow/today/reportingarea.dat | Pipe-delimited | No | Hourly | Lat/lon |
| AirNow (API) | airnowapi.org/aq/observation/... | JSON | Free key | Hourly | Lat/lon |
| NRC Reactors | nrc.gov/.../PowerReactorStatusForLast365Days.txt | Pipe-delimited | No | Daily | Plant name |
| CDC Syndromic | data.cdc.gov/resource/rdmq-nq56.json | JSON | No | Weekly | FIPS county |
| CDC NNDSS | data.cdc.gov/resource/x9gk-5huc.json | JSON | No | Weekly | State + geocode |
| CDC RESP-NET | data.cdc.gov/resource/kvib-3txy.json | JSON | No | Weekly | Site |
| CDC Mortality | data.cdc.gov/resource/r8kw-7aab.json | JSON | No | Weekly | State |
| CDC Wastewater | data.cdc.gov/resource/g653-rqe2.json | JSON | No | Weekly | Plant |
| USGS STN Floods | stn.wim.usgs.gov/STNServices/Events.json | JSON | No | Event-based | Event area |
| CPSC Recalls | saferproducts.gov/RestWebServices/Recall | JSON | No | As issued | National |
| EPA Water Violations | data.epa.gov/efservice/VIOLATION/... | XML | No | Quarterly | Water system |
