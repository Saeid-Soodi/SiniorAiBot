#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Package version: $(node -p "require('./package.json').version")"
echo "Git commit: $(git log -1 --oneline 2>/dev/null || echo 'not a git checkout')"
npm run check
echo "Running processes:"
ps aux | grep -E "node|passenger|lsnode" | grep -v grep || true
