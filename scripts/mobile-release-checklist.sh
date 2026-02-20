#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/mobile"

SKIP_BUILD=0
QA_EMAIL="${QA_EMAIL:-}"
QA_PASSWORD="${QA_PASSWORD:-}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/mobile-release-checklist.sh [options]

Interactive mobile release checklist for iOS and Android.
Automates preflight checks and API validation; guides manual smoke tests.

Options:
  --skip-build            Skip EAS build/submit steps (builds already done)
  --qa-email <email>      QA account email (or env QA_EMAIL, or prompted)
  --qa-password <pass>    QA account password (or env QA_PASSWORD, or prompted)
  -h, --help              Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      ;;
    --qa-email)
      shift
      QA_EMAIL="${1:-}"
      if [[ -z "$QA_EMAIL" ]]; then
        echo "Missing value for --qa-email"
        exit 1
      fi
      ;;
    --qa-password)
      shift
      QA_PASSWORD="${1:-}"
      if [[ -z "$QA_PASSWORD" ]]; then
        echo "Missing value for --qa-password"
        exit 1
      fi
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

# ── Colors ──────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass()  { printf "${GREEN}  PASS${NC}  %s\n" "$1"; }
fail()  { printf "${RED}  FAIL${NC}  %s\n" "$1"; }
warn()  { printf "${YELLOW}  WARN${NC}  %s\n" "$1"; }
info()  { printf "${CYAN}  INFO${NC}  %s\n" "$1"; }

# ── Results accumulator ─────────────────────────────────────────────────

RESULTS=()

record() {
  local status="$1"
  local label="$2"
  RESULTS+=("${status}|${label}")
  case "$status" in
    PASS) pass "$label" ;;
    FAIL) fail "$label" ;;
    SKIP) info "[SKIP] $label" ;;
    PENDING) warn "[PENDING] $label" ;;
  esac
}

# ── Interactive helpers ─────────────────────────────────────────────────

confirm_continue() {
  local section="$1"
  echo ""
  printf "${BOLD}Continue to %s? [y/N]${NC} " "$section"
  read -r answer
  answer="$(echo "$answer" | tr '[:upper:]' '[:lower:]')"
  if [[ "$answer" != "y" ]]; then
    echo "Aborted."
    exit 0
  fi
}

confirm_manual_step() {
  local label="$1"
  local instructions="$2"
  echo ""
  printf "${BOLD}── Manual check: %s${NC}\n" "$label"
  echo "$instructions"
  echo ""
  printf "Did this pass? [y/N/s(kip)] "
  read -r answer
  answer="$(echo "$answer" | tr '[:upper:]' '[:lower:]')"
  case "$answer" in
    y)   record "PASS" "$label" ;;
    s)   record "SKIP" "$label" ;;
    *)   record "PENDING" "$label" ;;
  esac
}

# ── Require commands ────────────────────────────────────────────────────

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Missing required command: $cmd"
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd npx
require_cmd curl
require_cmd jq

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  require_cmd eas
fi

# ── Load env vars from .env.local ───────────────────────────────────────

load_env() {
  local env_file="${MOBILE_DIR}/.env.local"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

echo ""
printf "${BOLD}==> Casaora Mobile Release Checklist${NC}\n"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# Section 1: Preflight
# ═════════════════════════════════════════════════════════════════════════

printf "${BOLD}==> Section 1: Preflight${NC}\n"

# 1. .env.local exists
if [[ -f "${MOBILE_DIR}/.env.local" ]]; then
  record "PASS" ".env.local exists"
  load_env
else
  record "FAIL" ".env.local exists"
fi

# 2. EXPO_PUBLIC_API_BASE_URL is production
API_URL="${EXPO_PUBLIC_API_BASE_URL:-}"
if [[ -z "$API_URL" ]]; then
  record "FAIL" "EXPO_PUBLIC_API_BASE_URL is set"
elif echo "$API_URL" | grep -qi "localhost\|127\.0\.0\.1\|10\.0\.2\.2"; then
  record "FAIL" "EXPO_PUBLIC_API_BASE_URL is production (got: $API_URL)"
else
  record "PASS" "EXPO_PUBLIC_API_BASE_URL is production"
fi

# 3. EXPO_PUBLIC_SUPABASE_URL is set
SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-}"
if [[ -n "$SUPABASE_URL" ]]; then
  record "PASS" "EXPO_PUBLIC_SUPABASE_URL is set"
else
  record "FAIL" "EXPO_PUBLIC_SUPABASE_URL is set"
fi

# 4. EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set
SUPABASE_KEY="${EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}"
if [[ -n "$SUPABASE_KEY" ]]; then
  record "PASS" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set"
else
  record "FAIL" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set"
fi

# 5. npm ci
info "Running npm ci..."
if (cd "$MOBILE_DIR" && npm ci --silent 2>&1); then
  record "PASS" "npm ci"
else
  record "FAIL" "npm ci"
fi

# 6. TypeScript check
info "Running typecheck..."
if (cd "$MOBILE_DIR" && npm run typecheck 2>&1); then
  record "PASS" "TypeScript check"
else
  record "FAIL" "TypeScript check"
fi

# 7. expo-doctor
info "Running expo-doctor..."
if (cd "$MOBILE_DIR" && npx expo-doctor 2>&1); then
  record "PASS" "expo-doctor"
else
  record "FAIL" "expo-doctor"
fi

# 8. Backend health check
# API_URL already includes /v1, so health is at ${API_URL}/health
if [[ -n "$API_URL" ]]; then
  info "Checking backend health at ${API_URL}/health..."
  HEALTH_JSON="$(curl -fsS "${API_URL}/health" 2>/dev/null || echo "")"
  if [[ -n "$HEALTH_JSON" ]]; then
    HEALTH_STATUS="$(echo "$HEALTH_JSON" | jq -r '.status // empty')"
    HEALTH_DB="$(echo "$HEALTH_JSON" | jq -r '.db // empty')"
    if [[ "$HEALTH_STATUS" == "ok" && "$HEALTH_DB" == "true" ]]; then
      record "PASS" "Backend health check"
    else
      record "FAIL" "Backend health check (status=$HEALTH_STATUS, db=$HEALTH_DB)"
    fi
  else
    record "FAIL" "Backend health check (no response)"
  fi
else
  record "SKIP" "Backend health check (no API URL)"
fi

# ═════════════════════════════════════════════════════════════════════════
# Section 2: iOS TestFlight
# ═════════════════════════════════════════════════════════════════════════

confirm_continue "Section 2: iOS TestFlight"
printf "${BOLD}==> Section 2: iOS TestFlight${NC}\n"

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  record "SKIP" "iOS production build"
  record "SKIP" "iOS TestFlight submission"
else
  # 9. iOS production build
  info "Starting iOS production build..."
  if (cd "$MOBILE_DIR" && eas build --platform ios --profile production --non-interactive 2>&1); then
    record "PASS" "iOS production build"
  else
    record "FAIL" "iOS production build"
  fi

  # 10. iOS TestFlight submission
  info "Submitting to TestFlight..."
  if (cd "$MOBILE_DIR" && eas submit --platform ios --profile production --non-interactive 2>&1); then
    record "PASS" "iOS TestFlight submission"
  else
    record "FAIL" "iOS TestFlight submission"
  fi
fi

# 11. iOS smoke test on device
confirm_manual_step "iOS smoke test on device" "$(cat <<'SMOKE'
Install the TestFlight build on a physical iOS device and verify:
  1. App launches without crash
  2. Login screen renders, sign in with QA account
  3. Task list loads and displays tasks
  4. Can tap into a task detail screen
  5. Pull-to-refresh works on the task list
  6. Sign out returns to login screen
SMOKE
)"

# ═════════════════════════════════════════════════════════════════════════
# Section 3: Android Internal Testing
# ═════════════════════════════════════════════════════════════════════════

confirm_continue "Section 3: Android Internal Testing"
printf "${BOLD}==> Section 3: Android Internal Testing${NC}\n"

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  record "SKIP" "Android production build"
  record "SKIP" "Android submission"
else
  # 12. Android production build
  info "Starting Android production build..."
  if (cd "$MOBILE_DIR" && eas build --platform android --profile production --non-interactive 2>&1); then
    record "PASS" "Android production build"
  else
    record "FAIL" "Android production build"
  fi

  # 13. Android submission
  info "Submitting to Google Play internal testing..."
  if (cd "$MOBILE_DIR" && eas submit --platform android --profile production --non-interactive 2>&1); then
    record "PASS" "Android submission"
  else
    record "FAIL" "Android submission"
  fi
fi

# 14. Android smoke test on device
confirm_manual_step "Android smoke test on device" "$(cat <<'SMOKE'
Install the internal testing build on a physical Android device and verify:
  1. App launches without crash
  2. Login screen renders, sign in with QA account
  3. Task list loads and displays tasks
  4. Can tap into a task detail screen
  5. Hardware back button navigates correctly
  6. Background the app and resume — state is preserved
  7. Force-kill and cold start — app recovers cleanly
  8. Sign out returns to login screen
SMOKE
)"

# ═════════════════════════════════════════════════════════════════════════
# Section 4: API Validation
# ═════════════════════════════════════════════════════════════════════════

confirm_continue "Section 4: API Validation"
printf "${BOLD}==> Section 4: API Validation${NC}\n"

if [[ -z "$API_URL" || -z "$SUPABASE_URL" || -z "$SUPABASE_KEY" ]]; then
  warn "Skipping API validation — missing env vars"
  record "SKIP" "Supabase auth token"
  record "SKIP" "GET /me"
  record "SKIP" "GET /tasks"
else
  # Collect QA credentials
  if [[ -z "$QA_EMAIL" ]]; then
    printf "QA account email: "
    read -r QA_EMAIL
  fi
  if [[ -z "$QA_PASSWORD" ]]; then
    printf "QA account password: "
    read -rsp QA_PASSWORD
    echo ""
  fi

  # 15. Supabase auth token
  info "Authenticating via Supabase..."
  AUTH_RESPONSE="$(curl -fsS \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${QA_EMAIL}\",\"password\":\"${QA_PASSWORD}\"}" \
    "${SUPABASE_URL}/auth/v1/token?grant_type=password" 2>/dev/null || echo "")"

  ACCESS_TOKEN=""
  if [[ -n "$AUTH_RESPONSE" ]]; then
    ACCESS_TOKEN="$(echo "$AUTH_RESPONSE" | jq -r '.access_token // empty')"
  fi

  if [[ -n "$ACCESS_TOKEN" ]]; then
    record "PASS" "Supabase auth token"
  else
    record "FAIL" "Supabase auth token"
  fi

  # 16. GET /me
  if [[ -n "$ACCESS_TOKEN" ]]; then
    info "Calling GET /me..."
    ME_RESPONSE="$(curl -fsS \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      "${API_URL}/me" 2>/dev/null || echo "")"

    if [[ -n "$ME_RESPONSE" ]]; then
      HAS_MEMBERSHIPS="$(echo "$ME_RESPONSE" | jq 'has("memberships")')"
      if [[ "$HAS_MEMBERSHIPS" == "true" ]]; then
        record "PASS" "GET /me"
      else
        record "FAIL" "GET /me (no memberships field)"
      fi
    else
      record "FAIL" "GET /me (no response)"
    fi
  else
    record "SKIP" "GET /me (no auth token)"
  fi

  # 17. GET /tasks
  if [[ -n "$ACCESS_TOKEN" ]]; then
    # Resolve org_id
    ORG_ID="${EXPO_PUBLIC_DEFAULT_ORG_ID:-}"
    if [[ -z "$ORG_ID" && -n "${ME_RESPONSE:-}" ]]; then
      ORG_ID="$(echo "$ME_RESPONSE" | jq -r '.memberships[0].organization_id // empty')"
    fi

    if [[ -n "$ORG_ID" ]]; then
      info "Calling GET /tasks?org_id=${ORG_ID}&limit=5..."
      TASKS_HTTP="$(curl -o /dev/null -w "%{http_code}" -fsS \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        "${API_URL}/tasks?org_id=${ORG_ID}&limit=5" 2>/dev/null || echo "000")"

      if [[ "$TASKS_HTTP" == "200" ]]; then
        record "PASS" "GET /tasks"
      else
        record "FAIL" "GET /tasks (HTTP $TASKS_HTTP)"
      fi
    else
      record "FAIL" "GET /tasks (no org_id resolved)"
    fi
  else
    record "SKIP" "GET /tasks (no auth token)"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════
# Section 5: Release Gate Summary
# ═════════════════════════════════════════════════════════════════════════

echo ""
printf "${BOLD}==> Release Gate Summary${NC}\n"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
PENDING_COUNT=0
SKIP_COUNT=0

for entry in "${RESULTS[@]}"; do
  status="${entry%%|*}"
  label="${entry#*|}"
  case "$status" in
    PASS)    printf "${GREEN}  PASS${NC}    %s\n" "$label"; PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL)    printf "${RED}  FAIL${NC}    %s\n" "$label"; FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    PENDING) printf "${YELLOW}  PENDING${NC} %s\n" "$label"; PENDING_COUNT=$((PENDING_COUNT + 1)) ;;
    SKIP)    printf "${CYAN}  SKIP${NC}    %s\n" "$label"; SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
done

TOTAL=${#RESULTS[@]}
echo ""
echo "Total: ${TOTAL}  Pass: ${PASS_COUNT}  Fail: ${FAIL_COUNT}  Pending: ${PENDING_COUNT}  Skip: ${SKIP_COUNT}"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  printf "${RED}${BOLD}RELEASE GATE: NOT PASSED${NC}\n"
  exit 1
elif [[ "$PENDING_COUNT" -gt 0 ]]; then
  printf "${YELLOW}${BOLD}RELEASE GATE: PENDING${NC}\n"
  exit 0
else
  printf "${GREEN}${BOLD}RELEASE GATE: PASSED${NC}\n"
  exit 0
fi
