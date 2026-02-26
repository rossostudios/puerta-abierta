#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-}"
SMOKE_BEARER_TOKEN="${SMOKE_BEARER_TOKEN:-}"
SMOKE_ORG_ID="${SMOKE_ORG_ID:-}"

if [[ -z "${API_BASE_URL}" ]]; then
  echo "API_BASE_URL is required (example: https://casaora.up.railway.app/v1)" >&2
  exit 2
fi

BASE="${API_BASE_URL%/}"

tmp_body="$(mktemp)"
cleanup() {
  rm -f "${tmp_body}"
}
trap cleanup EXIT

request() {
  local method="$1"
  local path="$2"
  shift 2 || true
  curl -sS -o "${tmp_body}" -w "%{http_code}" -X "${method}" "$@" "${BASE}${path}"
}

echo "==> API smoke (${BASE})"

status_live="$(request GET /live)"
echo "/live -> ${status_live}"
[[ "${status_live}" == "200" ]] || { cat "${tmp_body}"; exit 1; }

status_ready="$(request GET /ready)"
echo "/ready -> ${status_ready}"
[[ "${status_ready}" == "200" ]] || { cat "${tmp_body}"; exit 1; }

status_public="$(request GET /public/listings)"
echo "/public/listings -> ${status_public}"
[[ "${status_public}" == "200" ]] || { cat "${tmp_body}"; exit 1; }

if [[ -n "${SMOKE_BEARER_TOKEN}" ]]; then
  status_me="$(request GET /me -H "Authorization: Bearer ${SMOKE_BEARER_TOKEN}")"
  echo "/me -> ${status_me}"
  [[ "${status_me}" == "200" ]] || { cat "${tmp_body}"; exit 1; }

  if [[ -n "${SMOKE_ORG_ID}" ]]; then
    status_props="$(request GET "/properties?org_id=${SMOKE_ORG_ID}&limit=1" -H "Authorization: Bearer ${SMOKE_BEARER_TOKEN}")"
    echo "/properties -> ${status_props}"
    [[ "${status_props}" == "200" ]] || { cat "${tmp_body}"; exit 1; }
  fi
fi

echo "API smoke passed"
