#!/usr/bin/env bash
set -euo pipefail

INPUT="data/areas_base.geojson"
OUTPUT_DIR="areas"
OUTPUT_PM="areas/areas.pmtiles"

mkdir -p "$OUTPUT_DIR"

if [ ! -f "$INPUT" ]; then
  echo "ERROR: $INPUT not found. Run fetch script first."
  exit 1
fi

tippecanoe \
  -zg \
  -o "$OUTPUT_PM" \
  -l areas_base \
  --generate-ids \
  --force \
  "$INPUT"

echo "Tiles written to $OUTPUT_PM"
