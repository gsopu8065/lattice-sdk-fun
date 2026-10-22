#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MOTION_CAPTURE_SERVICE=raspberry-pi-motion-capture
LIVE_STREAM_SERVICE=raspberry-pi-live-stream

cd "$PROJECT_DIR"

printf '%s\n' "Updating motion capture app in $PROJECT_DIR..."
git pull --ff-only
npm ci
npm run build

if systemctl is-enabled "$MOTION_CAPTURE_SERVICE" >/dev/null 2>&1; then
  sudo systemctl restart "$MOTION_CAPTURE_SERVICE"
  sudo systemctl --no-pager --full status "$MOTION_CAPTURE_SERVICE"
else
  printf '%s\n' "$MOTION_CAPTURE_SERVICE is disabled (camera likely owned by MediaMTX); leaving it stopped."
fi

if systemctl is-enabled "$LIVE_STREAM_SERVICE" >/dev/null 2>&1; then
  sudo systemctl restart "$LIVE_STREAM_SERVICE"
  sudo systemctl --no-pager --full status "$LIVE_STREAM_SERVICE"
fi

printf '%s\n' "Update complete."
