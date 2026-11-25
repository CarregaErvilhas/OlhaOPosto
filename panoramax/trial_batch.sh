#!/usr/bin/env bash
# Trial point 10 (Docs/infra.md, section 9): send a burst of pictures in one
# upload set and time the worker, to read the RAM peak of `pano` in the GUI.
#
# Usage:
#   PANORAMAX_TOKEN=... panoramax/trial_batch.sh photo1.jpg photo2.jpg ...
#
# Each file must be different: Panoramax rejects a file whose MD5 is already
# on the server. Prints the upload set id at the end, for the DELETE.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: trial_batch.sh photo.jpg..." >&2; exit 1; }
base=${PANORAMAX_URL:-http://pano.zerops:5000}
: "${PANORAMAX_TOKEN:?set PANORAMAX_TOKEN to the olhaoposto account JWT}"

api() {
  curl -sS --fail-with-body -H @- "$@" <<<"Authorization: Bearer $PANORAMAX_TOKEN"
}

# no_deduplication: the pictures get nearby fake coordinates, which the
# default 1 m / 60° rule would otherwise drop as duplicates.
set_id=$(api -X POST "$base/api/upload_sets" -H 'Content-Type: application/json' \
  -d "{\"title\": \"trial batch\", \"estimated_nb_files\": $#, \"no_split\": true, \"no_deduplication\": true, \"visibility\": \"owner-only\"}" |
  jq -r .id)
echo "upload set: $set_id"

start=$(date +%s)
i=0
for f in "$@"; do
  i=$((i + 1))
  # ~11 m apart along a north-south line in Lisbon, one second apart.
  lat=$(awk -v i="$i" 'BEGIN { printf "%.6f", 38.7369 + i * 0.0001 }')
  # One rejected file (409 duplicate, 400 bad JPEG) must not stop the burst:
  # print the server's message and go on.
  out=$(api -X POST "$base/api/upload_sets/$set_id/files" \
    -F "file=@$f;type=image/jpeg" \
    -F "override_latitude=$lat" \
    -F "override_longitude=-9.1427" \
    -F "override_capture_time=$(date -u -r $((start + i)) +%Y-%m-%dT%H:%M:%SZ)" \
    -F "isBlurred=true" 2>&1) || true
  jq -c --arg f "$(basename "$f")" '{file: $f, picture_id, message}' <<<"$out" 2>/dev/null ||
    echo "$(basename "$f"): $out"
done
api -X POST "$base/api/upload_sets/$set_id/complete" >/dev/null
echo "sent $i files in $(($(date +%s) - start)) s, waiting for the worker"

for _ in $(seq 1 150); do
  state=$(api "$base/api/upload_sets/$set_id")
  if jq -e '(.items_status.not_processed // 1) == 0 and (.items_status.preparing // 1) == 0' <<<"$state" >/dev/null; then break; fi
  sleep 2
done
jq -c '.items_status' <<<"$state"
echo "processed in $(($(date +%s) - start)) s total"
echo
echo "Read the RAM peak of pano in the Zerops GUI for this window, then delete:"
echo "  DELETE $base/api/upload_sets/$set_id"
