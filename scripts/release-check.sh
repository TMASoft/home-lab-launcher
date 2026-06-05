#!/usr/bin/env sh
set -eu
tracked="$(git ls-files .env node_modules)"
if [ -n "$tracked" ]; then
  echo "[release-check] these local secret/dependency paths must not be tracked:" >&2
  echo "$tracked" >&2
  exit 1
fi
echo "[release-check] tracked secret/dependency checks passed"
