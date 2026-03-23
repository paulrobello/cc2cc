#!/usr/bin/env bash
# check-secrets.sh — Pre-commit guard against accidental secret commits.
#
# Checks staged files for patterns that look like real API keys or
# credentials rather than the placeholder values required in .env.example.
#
# Install as a pre-commit hook:
#   cp scripts/check-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or register via git config:
#   git config core.hooksPath .githooks
#   mkdir -p .githooks
#   cp scripts/check-secrets.sh .githooks/pre-commit
#   chmod +x .githooks/pre-commit

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAIL=0

# ---------------------------------------------------------------------------
# 1. Block .env files that contain real-looking values.
#    A "real-looking" API key is any value that is NOT one of the known
#    placeholder strings defined in .env.example.
# ---------------------------------------------------------------------------
PLACEHOLDER_PATTERNS=(
  "your-api-key-here"
  "your-redis-password-here"
  "change-me-before-use"
  "changeme"
  "localhost"
  "127.0.0.1"
  "ws://localhost"
  "ws://127.0.0.1"
  ""  # empty value is fine
)

# Staged .env files (but NOT .env.example — that must only have placeholders)
STAGED_ENV_FILES=$(git diff --cached --name-only | grep -E '(^|/)\.env(\.|$)' | grep -v '\.example$' || true)

for file in $STAGED_ENV_FILES; do
  if [[ ! -f "$file" ]]; then
    continue
  fi

  # Check each KEY=VALUE line in the file
  while IFS= read -r line; do
    # Skip comments and blank lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue

    # Extract value after '='
    value="${line#*=}"

    # Skip if value is empty
    [[ -z "$value" ]] && continue

    # Check if value matches any known placeholder
    is_placeholder=0
    for placeholder in "${PLACEHOLDER_PATTERNS[@]}"; do
      if [[ "$value" == "$placeholder" ]]; then
        is_placeholder=1
        break
      fi
    done

    if [[ $is_placeholder -eq 0 ]]; then
      # Value is not a known placeholder — check if it looks like a secret.
      # Flag values that are high-entropy strings (>= 16 chars, no spaces)
      # or look like IP addresses / hostnames (i.e., the file has real config).
      char_count=${#value}
      if [[ $char_count -ge 16 && ! "$value" =~ [[:space:]] ]]; then
        echo -e "${RED}[check-secrets] Possible real secret in staged file: ${file}${NC}"
        echo -e "${YELLOW}  Line: ${line}${NC}"
        echo -e "  If this is intentional, use 'git commit --no-verify' (only if you are CERTAIN)."
        FAIL=1
      fi
    fi
  done < "$file"
done

# ---------------------------------------------------------------------------
# 2. Block any file that contains the literal placeholder key values used in
#    .env.example but was not supposed to be committed at all (belt-and-braces
#    against accidentally staging a real .env that someone renamed).
# ---------------------------------------------------------------------------
STAGED_FILES=$(git diff --cached --name-only || true)

BANNED_PATTERNS=(
  # Real high-entropy token patterns — 32+ hex chars
  '[0-9a-f]{32,}'
  # JWT-like patterns
  'eyJ[A-Za-z0-9_-]{20,}'
  # Typical secret/password assignment with real-looking values
  'CC2CC_HUB_API_KEY=[^y][^o][^u][^r]'  # anything not starting with "your"
  'CC2CC_API_KEY=[^y][^o][^u][^r]'
  'NEXT_PUBLIC_CC2CC_HUB_API_KEY=[^y][^o][^u][^r]'
)

for file in $STAGED_FILES; do
  # Only inspect text files; skip binaries and the example file itself
  [[ "$file" == *.example ]] && continue
  [[ "$file" == "scripts/check-secrets.sh" ]] && continue
  [[ ! -f "$file" ]] && continue

  # Only scan known sensitive file types
  if [[ "$file" =~ \.(env|local|sh|json|yaml|yml|toml|md)$ ]] || \
     [[ "$file" =~ (^|/)\.env ]]; then
    for pattern in "${BANNED_PATTERNS[@]}"; do
      if git show ":${file}" 2>/dev/null | grep -qP "$pattern" 2>/dev/null; then
        echo -e "${RED}[check-secrets] Pattern match in staged file: ${file}${NC}"
        echo -e "${YELLOW}  Pattern: ${pattern}${NC}"
        echo -e "  Review and remove any real credentials before committing."
        FAIL=1
        break
      fi
    done
  fi
done

# ---------------------------------------------------------------------------
# 3. Warn if dashboard/.env.local is accidentally staged.
# ---------------------------------------------------------------------------
if git diff --cached --name-only | grep -q "dashboard/\.env\.local$"; then
  echo -e "${RED}[check-secrets] dashboard/.env.local is staged for commit.${NC}"
  echo -e "  This file contains the NEXT_PUBLIC API key baked into the browser bundle."
  echo -e "  It must not be committed. Run: git restore --staged dashboard/.env.local"
  FAIL=1
fi

# ---------------------------------------------------------------------------
if [[ $FAIL -ne 0 ]]; then
  echo -e "\n${RED}Pre-commit check failed. Remove secrets before committing.${NC}"
  echo -e "Key rotation procedure: see README.md § Security > API Key Rotation."
  exit 1
fi

echo "[check-secrets] No secrets detected in staged files."
exit 0
