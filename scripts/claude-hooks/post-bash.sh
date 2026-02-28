#!/usr/bin/env bash
# PostToolUse hook for Bash commands — lightweight reminders
# Reads Claude Code hook JSON from stdin, checks the command, prints reminders.
# Always exits 0 (never blocks post-execution).

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$CMD" ]]; then
  exit 0
fi

# After git commit — remind to run quality gate
if echo "$CMD" | grep -qE 'git\s+commit'; then
  echo "Reminder: Run \`./scripts/quality-gate.sh fast\` before pushing"
fi

# After terraform apply — remind to verify
if echo "$CMD" | grep -qE 'terraform\s+apply'; then
  echo "Reminder: Verify apply output and ECS task health"
fi

exit 0
