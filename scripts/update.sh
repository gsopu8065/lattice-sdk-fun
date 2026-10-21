#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVICE_NAME=raspberry-pi-motion-capture

cd "$PROJECT_DIR"

printf '%s\n' "Updating motion capture app in $PROJECT_DIR..."
git pull --ff-only
npm ci
npm run build
npm test
sudo systemctl restart "$SERVICE_NAME"

printf '%s\n' "Update complete. Service status:"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
