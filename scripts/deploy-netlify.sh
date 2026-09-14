#!/usr/bin/env bash
set -euo pipefail

# Assembles the current tile outputs into a clean publish directory and
# pushes them straight to Netlify. This intentionally never touches git:
# the tiles are reproducible from Supabase at any time, so there is no
# need to keep a growing history of large binary files in the repo.
#
# Each archive is published twice:
#
#   /tiles/<name>-<hash>.pmtiles  content-addressed, served immutable
#   /<name>/<name>.pmtiles        legacy fixed path, must revalidate
#
# The content-addressed copy is what the app should read. Because the hash is
# part of the filename, the CDN can cache it forever and the browser never has
# to revalidate the thousands of HTTP range requests a PMTiles archive serves.
# The fixed path stays for older clients (and anything outside this project
# pointing at it), but every range request against it costs an origin
# revalidation, so it is the slow path by design.
#
# version.json maps names to the current content-addressed URLs. It is the only
# file clients need to re-check, and it is a few hundred bytes.

DIST_DIR="dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/tiles" "$DIST_DIR/areas" "$DIST_DIR/limits"

cp _headers "$DIST_DIR/_headers"

# Short content hash of an archive. Hashing the built .pmtiles (rather than the
# source GeoJSON) means the URL only changes when the bytes clients download
# actually change — a rebuild from unchanged data keeps the existing URL, so
# warm caches survive the weekly run.
# `sha256sum` is the GNU coreutils name used by the CI runner; `shasum` is what
# macOS ships, so the script also works when run by hand.
hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -c1-12
  else
    shasum -a 256 "$1" | cut -c1-12
  fi
}

# publish <name> <source_path> <legacy_dir>
# Emits the content-addressed copy and the legacy fixed-path copy, and prints
# the public URL of the content-addressed one.
publish() {
  local name="$1"
  local src="$2"
  local legacy_dir="$3"

  if [ ! -f "$src" ]; then
    echo "ERROR: $src not found" >&2
    exit 1
  fi

  local hash
  hash="$(hash_of "$src")"

  cp "$src" "$DIST_DIR/tiles/${name}-${hash}.pmtiles"
  cp "$src" "$DIST_DIR/${legacy_dir}/${name}.pmtiles"

  echo "/tiles/${name}-${hash}.pmtiles"
}

AREAS_URL="$(publish areas areas/areas.pmtiles areas)"
LIMITS_URL="$(publish limits limits/limits.pmtiles limits)"

cat > "$DIST_DIR/version.json" <<JSON
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "areas": "${AREAS_URL}",
  "limits": "${LIMITS_URL}"
}
JSON

echo "=== Publish manifest ==="
cat "$DIST_DIR/version.json"

echo "=== Deploying $DIST_DIR to Netlify ==="
npx netlify deploy \
  --prod \
  --dir="$DIST_DIR" \
  --site="$NETLIFY_SITE_ID" \
  --message "Update areas tiles from Supabase ($(date -u +"%Y-%m-%dT%H:%M:%SZ"))"
