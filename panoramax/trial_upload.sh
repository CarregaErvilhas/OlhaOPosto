#!/usr/bin/env bash
# Trial points 2 and 3 (Docs/infra.md, section 9): send one isolated picture
# with tags through the upload_sets API, then wait for the worker to process it.
#
# Usage:
#   PANORAMAX_TOKEN=... panoramax/trial_upload.sh photo.jpg [lat lon]
#
# PANORAMAX_URL defaults to the private address over the Zerops VPN
# (zcli vpn up -P <project-id>). The token is the `olhaoposto` service account
# JWT from service_account.py. It goes to curl through a here-string, so it
# never shows up in `ps`.
set -euo pipefail

file=${1:?usage: trial_upload.sh photo.jpg [lat lon]}
lat=${2:-38.7369}
lon=${3:--9.1427}
base=${PANORAMAX_URL:-http://pano.zerops:5000}
: "${PANORAMAX_TOKEN:?set PANORAMAX_TOKEN to the olhaoposto account JWT}"

# Panoramax only accepts .jpg/.jpeg file names.
# tr and not ${file,,}: macOS ships bash 3.2.
case "$(tr '[:upper:]' '[:lower:]' <<<"$file")" in *.jpg | *.jpeg) ;; *) echo "need a .jpg file" >&2; exit 1 ;; esac

api() {
  # -H @- reads the auth header from stdin, keeping the token out of argv.
  curl -sS --fail-with-body -H @- "$@" <<<"Authorization: Bearer $PANORAMAX_TOKEN"
}

# Same tags as Docs/plan.md, with example IDs.
semantics='[
  {"key": "osm|ref:EU:EVSE", "value": "PT*TRK*E*VNT*00005*01"},
  {"key": "olhaoposto|site", "value": "TRK-VNT-00005"},
  {"key": "olhaoposto|author", "value": "trial"}
]'

echo "== upload set"
set_id=$(api -X POST "$base/api/upload_sets" -H 'Content-Type: application/json' \
  -d '{"title": "trial upload", "estimated_nb_files": 1, "no_split": true, "visibility": "owner-only"}' |
  jq -r .id)
echo "id: $set_id"

echo "== file"
api -X POST "$base/api/upload_sets/$set_id/files" \
  -F "file=@$file;type=image/jpeg" \
  -F "override_latitude=$lat" \
  -F "override_longitude=$lon" \
  -F "override_capture_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -F "isBlurred=true" \
  -F "semantics=$semantics;type=application/json" | jq '{picture_id, inserted_at, rejected}'

echo "== complete"
api -X POST "$base/api/upload_sets/$set_id/complete" | jq '{completed, dispatched, ready}'

echo "== waiting for the worker"
for _ in $(seq 1 30); do
  state=$(api "$base/api/upload_sets/$set_id")
  if jq -e '.ready == true or ((.items_status.not_processed // 1) == 0 and (.associated_collections | length) > 0)' \
    <<<"$state" >/dev/null; then break; fi
  sleep 2
done
jq '{ready, nb_items, items_status, associated_collections: [.associated_collections[]? | {id, nb_items, ready}]}' <<<"$state"

col=$(jq -r '.associated_collections[0].id // empty' <<<"$state")
if [ -n "$col" ]; then
  echo "== picture (with token)"
  api "$base/api/collections/$col/items" |
    jq '.features[] | {id, status: .properties."geovisio:status", visibility: .properties."geovisio:visibility", semantics: .properties.semantics, assets: (.assets | keys)}'
  echo "== same collection without token (owner-only should hide it)"
  curl -sS -o /dev/null -w '%{http_code}\n' "$base/api/collections/$col/items"
fi

echo
echo "Now check the R2 bucket 'panoramax': data/permanent/ and data/derivatives/ should have files."
