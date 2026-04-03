#!/bin/sh
#
# load-tiger.sh — Download and import Census TIGER/Line boundary data into PostGIS.
#
# Uses shp2pgsql (included via Alpine postgis package in app container).
# Called automatically by db.js on first startup if tiger_states is empty.
#

set -e

DB_URL="${DATABASE_URL:-postgresql://hazardpulse:hazardpulse@db:5432/hazardpulse}"
TIGER_YEAR="${TIGER_YEAR:-2024}"
BASE_URL="https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}"
WORK_DIR="/tmp/tiger_data"

mkdir -p "$WORK_DIR"

load_shapefile() {
  TABLE="$1"
  URL="$2"
  MODE="${3:--c}"  # -c = create (default), -a = append

  cd "$WORK_DIR"
  wget -q -O "${TABLE}_tmp.zip" "$URL"
  unzip -o -q "${TABLE}_tmp.zip" -d "${TABLE}_dir"

  SHP_FILE=$(find "${TABLE}_dir" -name "*.shp" | head -1)
  if [ -z "$SHP_FILE" ]; then
    echo "  WARN: No .shp in download, skipping"
    rm -rf "${TABLE}_tmp.zip" "${TABLE}_dir"
    return 0
  fi

  shp2pgsql -s 4326 "$MODE" -D -g geom "$SHP_FILE" "$TABLE" | psql "$DB_URL" -q
  rm -rf "${TABLE}_tmp.zip" "${TABLE}_dir"
}

echo ""
echo "=== Loading Census TIGER/Line ${TIGER_YEAR} boundary data ==="
echo ""

# States — single national file (~3 MB)
echo "⏳ States..."
load_shapefile "tiger_states" "${BASE_URL}/STATE/tl_${TIGER_YEAR}_us_state.zip"
psql "$DB_URL" -c "CREATE INDEX IF NOT EXISTS idx_tiger_states_geom ON tiger_states USING GIST (geom);"
echo "✓ States loaded"

# Counties — single national file (~12 MB)
echo "⏳ Counties..."
load_shapefile "tiger_counties" "${BASE_URL}/COUNTY/tl_${TIGER_YEAR}_us_county.zip"
psql "$DB_URL" -c "CREATE INDEX IF NOT EXISTS idx_tiger_counties_geom ON tiger_counties USING GIST (geom);"
psql "$DB_URL" -c "CREATE INDEX IF NOT EXISTS idx_tiger_counties_fips ON tiger_counties (statefp, countyfp);"
echo "✓ Counties loaded"

# Places — per-state files (FIPS codes 01-78)
echo "⏳ Places (per-state downloads)..."
FIPS_CODES="01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56 60 66 69 72 78"
FIRST=true
for FIPS in $FIPS_CODES; do
  URL="${BASE_URL}/PLACE/tl_${TIGER_YEAR}_${FIPS}_place.zip"
  if $FIRST; then
    load_shapefile "tiger_places" "$URL" "-c" 2>/dev/null && FIRST=false || true
  else
    load_shapefile "tiger_places" "$URL" "-a" 2>/dev/null || true
  fi
done
psql "$DB_URL" -c "CREATE INDEX IF NOT EXISTS idx_tiger_places_geom ON tiger_places USING GIST (geom);"
PLACE_COUNT=$(psql "$DB_URL" -t -A -c "SELECT COUNT(*) FROM tiger_places")
echo "✓ Places loaded (${PLACE_COUNT} entries)"

echo ""
echo "=== TIGER/Line import complete ==="

rm -rf "$WORK_DIR"
