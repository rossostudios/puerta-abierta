#!/usr/bin/env bash
# PreToolUse hook for Edit/Write operations — neurosymbolic guardrails
# Reads Claude Code hook JSON from stdin, extracts file_path, and blocks or warns.
# Exit 0 = allow (with optional stdout message), Exit 2 = hard block

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# --- Hard blocks (exit 2) ---

# Block writing to private key / credential files
if echo "$FILE_PATH" | grep -qE '\.(pem|key|p12|keystore)$' || \
   echo "$FILE_PATH" | grep -qE 'credentials\.json$'; then
  echo '{"decision":"block","reason":"BLOCKED: Writing to sensitive credential files is not allowed"}' >&2
  exit 2
fi

# Block writing to terraform state files
if echo "$FILE_PATH" | grep -qE 'terraform\.tfstate(\.backup)?$'; then
  echo '{"decision":"block","reason":"BLOCKED: Never write directly to terraform state files"}' >&2
  exit 2
fi

# --- Contextual warnings (stdout message, exit 0) ---

if echo "$FILE_PATH" | grep -q 'infra/terraform/aws/'; then
  echo "Note: Editing Terraform config — run \`terraform plan\` before apply"
fi

if echo "$FILE_PATH" | grep -q 'auth\.rs'; then
  echo "Note: Editing auth module — verify Clerk JWT validation unchanged"
fi

if echo "$FILE_PATH" | grep -q 'middleware/security\.rs'; then
  echo "Note: Editing security middleware — review security headers"
fi

if echo "$FILE_PATH" | grep -q 'tenancy\.rs'; then
  echo "Note: Editing tenancy module — verify RLS/org_id enforcement"
fi

if echo "$FILE_PATH" | grep -q 'db/migrations/'; then
  echo "Note: Editing migration — test migration before applying to prod"
fi

exit 0
