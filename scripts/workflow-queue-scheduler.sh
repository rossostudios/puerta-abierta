#!/usr/bin/env bash
set -euo pipefail

RUN=0
TARGET_ENV="${TARGET_ENV:-production}"

FUNCTION_NAME="${FUNCTION_NAME:-process-workflow-jobs}"
FUNCTION_PATH="${FUNCTION_PATH:-apps/backend-rs/railway-functions/process-workflow-jobs.ts}"
FUNCTION_CRON="${FUNCTION_CRON:-* * * * *}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/workflow-queue-scheduler.sh [options]

Options:
  --run                  Execute commands. Without this, prints a dry run only.
  --environment <name>   Railway environment name (default: production).
  --cron "<expr>"        Cron expression (default: "* * * * *").
  -h, --help             Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      RUN=1
      ;;
    --environment)
      shift
      TARGET_ENV="${1:-}"
      [[ -n "$TARGET_ENV" ]] || { echo "Missing value for --environment"; exit 1; }
      ;;
    --cron)
      shift
      FUNCTION_CRON="${1:-}"
      [[ -n "$FUNCTION_CRON" ]] || { echo "Missing value for --cron"; exit 1; }
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

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

require_cmd railway
require_cmd grep

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

run_cmd() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
  if [[ "$RUN" -eq 1 ]]; then
    "$@"
  fi
}

function_exists() {
  local env="$1"
  local name="$2"
  railway functions -e "$env" list 2>/dev/null | grep -q "^${name} "
}

echo "Workflow queue scheduler mode: $([[ "$RUN" -eq 1 ]] && echo "RUN" || echo "DRY-RUN")"
echo "Target environment: $TARGET_ENV"
echo "Function name: $FUNCTION_NAME"
echo "Function cron: $FUNCTION_CRON"
echo

if function_exists "$TARGET_ENV" "$FUNCTION_NAME"; then
  run_cmd railway functions -e "$TARGET_ENV" delete --function "$FUNCTION_NAME" --yes
fi

run_cmd railway functions -e "$TARGET_ENV" new \
  --name "$FUNCTION_NAME" \
  --path "$FUNCTION_PATH" \
  --cron "$FUNCTION_CRON" \
  --http false

echo
echo "Scheduler functions in $TARGET_ENV:"
run_cmd railway functions -e "$TARGET_ENV" list

echo
if [[ "$RUN" -eq 1 ]]; then
  echo "Workflow queue scheduler configured."
else
  echo "Dry run complete. Re-run with --run to execute."
fi
