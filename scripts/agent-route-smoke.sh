#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000/v1}"
ORG_ID="${ORG_ID:-}"
TOKEN="${TOKEN:-}"
CHAT_ID="${CHAT_ID:-}"

if [[ -z "$ORG_ID" ]]; then
  echo "ORG_ID is required"
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "TOKEN is required"
  exit 1
fi

auth_header=("Authorization: Bearer ${TOKEN}")
json_header=("Accept: application/json")

curl_json() {
  local url="$1"
  shift
  curl -fsS "$url" -H "${auth_header[0]}" -H "${json_header[0]}" "$@"
}

echo "[smoke] GET /agent/chats"
curl_json "${BASE_URL}/agent/chats?org_id=${ORG_ID}&limit=1" >/dev/null

echo "[smoke] GET /agent/approvals"
curl_json "${BASE_URL}/agent/approvals?org_id=${ORG_ID}" >/dev/null

echo "[smoke] GET /agent/approval-policies"
curl_json "${BASE_URL}/agent/approval-policies?org_id=${ORG_ID}" >/dev/null

echo "[smoke] GET /agent/inbox"
curl_json "${BASE_URL}/agent/inbox?org_id=${ORG_ID}&limit=5" >/dev/null

if [[ -n "$CHAT_ID" ]]; then
  echo "[smoke] POST /agent/chats/${CHAT_ID}/messages/stream"
  stream_payload='{"message":"health check", "allow_mutations":false, "confirm_write":false}'
  stream_output=$(curl -fsS \
    "${BASE_URL}/agent/chats/${CHAT_ID}/messages/stream?org_id=${ORG_ID}" \
    -H "${auth_header[0]}" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d "$stream_payload" | head -n 200)

  if ! grep -q '"type":"tool_call"\|"type":"token"\|"type":"done"' <<<"$stream_output"; then
    echo "stream smoke failed: expected SSE event types not found"
    exit 1
  fi
fi

echo "[smoke] done"
