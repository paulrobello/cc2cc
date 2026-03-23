#!/bin/bash
# Sync skill/ changes directly to the installed plugin cache.
# Run this after any change to skill/ to avoid reinstall cache-skip issues.

CACHE="$HOME/.claude/plugins/cache/probello-local/cc2cc/0.2.0"

if [ ! -d "$CACHE" ]; then
  echo "Cache not found: $CACHE"
  echo "Run: /plugin install cc2cc@probello-local  first"
  exit 1
fi

rsync -av --exclude='node_modules' /Users/probello/Repos/cc2cc/skill/ "$CACHE/"
echo "Synced skill/ → $CACHE"
