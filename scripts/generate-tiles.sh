#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="areas"
mkdir -p "$OUTPUT_DIR"

# Two archives, because the website loads them separately: areas.pmtiles is the
# default map, complementary.pmtiles is only fetched once a reader switches a
# complementary class on in the legend. Keeping them apart is what keeps the
# archive everybody loads small.
#
# The layer name inside each archive is part of the website's contract with it
# (MapLibre's `source-layer`), so these must stay in step with MapContainer.vue.
build() {
  local input="$1"
  local output="$2"
  local layer="$3"
  shift 3

  if [ ! -f "$input" ]; then
    echo "ERROR: $input not found. Run fetch script first."
    exit 1
  fi

  tippecanoe \
    -o "$output" \
    -l "$layer" \
    --force \
    -zg \
    --use-attribute-for-id=id \
    --include=id \
    --include=area_type \
    --include=area_class \
    --include=country \
    "$@" \
    "$input"

  echo "Tiles written to $output"
}

build "${OUTPUT_DIR}/areas.geojson" "${OUTPUT_DIR}/areas.pmtiles" polygons

# --include=area_designation: these classes carry a dozen instruments under one
# colour, so the designation is what distinguishes them on the map.
# --drop-densest-as-needed: Programa Socio Bosque alone is ~1.2k parcels, many
# of them tiny and tightly clustered, which would otherwise blow the tile size
# limit at low zoom and drop whole tiles instead of individual features.
build "${OUTPUT_DIR}/complementary.geojson" "${OUTPUT_DIR}/complementary.pmtiles" complementary \
  --include=area_designation \
  --drop-densest-as-needed
