#!/usr/bin/env bash
set -euo pipefail

# Input and output paths
INPUT="areas/areas.geojson"
OUTPUT_DIR="areas"
OUTPUT_PM="${OUTPUT_DIR}/areas.pmtiles"

mkdir -p "$OUTPUT_DIR"

if [ ! -f "$INPUT" ]; then
  echo "ERROR: $INPUT not found. Run fetch script first."
  exit 1
fi

# Tippecanoe flags mirroring your R script (except output name)
tippecanoe \
  -o "$OUTPUT_PM" \
  -l polygons \
  --force \
  -zg \
  --use-attribute-for-id=id \
  --include=id \
  --include=area_type \
  --include=area_class \
  "$INPUT"

echo "Tiles written to $OUTPUT_PM"
