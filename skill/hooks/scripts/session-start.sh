#!/bin/bash
set -euo pipefail
# SessionStart hook — writes the Claude session ID to {cwd}/.claude/.cc2cc-session-id
# Receives JSON payload on stdin with at least: session_id, cwd

payload=$(cat)

session_id=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)
cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)

if [ -z "$session_id" ] || [ -z "$cwd" ]; then
  exit 0
fi

mkdir -p "${cwd}/.claude" 2>/dev/null || true
printf '%s' "$session_id" > "${cwd}/.claude/.cc2cc-session-id"
