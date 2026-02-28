#!/usr/bin/env bash
# PreToolUse hook for Bash commands — neurosymbolic guardrails
# Reads Claude Code hook JSON from stdin, extracts the command, and blocks dangerous patterns.
# Exit 0 = allow, Exit 2 = hard block (with message on stderr)

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$CMD" ]]; then
  exit 0
fi

# Normalize to lowercase for case-insensitive matching
CMD_LOWER=$(echo "$CMD" | tr '[:upper:]' '[:lower:]')

# --- Hard blocks (exit 2) ---

# Block rm -rf targeting root, home, or $HOME
if echo "$CMD" | grep -qE 'rm\s+-rf\s+(/|~/|\$HOME)'; then
  echo '{"decision":"block","reason":"BLOCKED: rm -rf targeting root or home directory"}' >&2
  exit 2
fi

# Block DROP TABLE / DROP DATABASE
if echo "$CMD_LOWER" | grep -qE 'drop\s+(table|database)'; then
  echo '{"decision":"block","reason":"BLOCKED: DROP TABLE/DATABASE — use migrations instead"}' >&2
  exit 2
fi

# Block git push --force to main/master
if echo "$CMD" | grep -qE 'git\s+push\s+.*--force.*\s+(main|master)' || \
   echo "$CMD" | grep -qE 'git\s+push\s+--force.*\s+(main|master)' || \
   echo "$CMD" | grep -qE 'git\s+push\s+-f\s+.*\s+(main|master)'; then
  echo '{"decision":"block","reason":"BLOCKED: force push to main/master is not allowed"}' >&2
  exit 2
fi

# Block terraform destroy without -target
if echo "$CMD_LOWER" | grep -qE 'terraform\s+destroy' && ! echo "$CMD_LOWER" | grep -q '\-target'; then
  echo '{"decision":"block","reason":"BLOCKED: terraform destroy requires -target flag"}' >&2
  exit 2
fi

# Block DELETE FROM without WHERE
if echo "$CMD_LOWER" | grep -qE 'delete\s+from' && ! echo "$CMD_LOWER" | grep -qi 'where'; then
  echo '{"decision":"block","reason":"BLOCKED: DELETE FROM requires a WHERE clause"}' >&2
  exit 2
fi

# --- Pass-through ---
exit 0
