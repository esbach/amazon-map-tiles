#!/usr/bin/env bash
set -euo pipefail

# Assembles the current tile outputs into a clean publish directory and
# pushes them straight to Netlify. This intentionally never touches git:
# the tiles are reproducible from Supabase at any time, so there is no
# need to keep a growing history of large binary files in the repo.

DIST_DIR="dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/areas" "$DIST_DIR/limits"

cp _headers "$DIST_DIR/_headers"
cp areas/areas.pmtiles "$DIST_DIR/areas/areas.pmtiles"
cp limits/limits.pmtiles "$DIST_DIR/limits/limits.pmtiles"

echo "=== Deploying $DIST_DIR to Netlify ==="
npx netlify deploy \
  --prod \
  --dir="$DIST_DIR" \
  --site="$NETLIFY_SITE_ID" \
  --message "Update areas tiles from Supabase ($(date -u +"%Y-%m-%dT%H:%M:%SZ"))"
