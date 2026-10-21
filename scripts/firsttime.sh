#!/bin/sh
set -eu

EXPECTED_USER=srujanjs
SOURCE_DIR=/home/srujanjs/Documents/code/lattice-sdk-fun
PROJECT_DIR=/opt/raspberry-pi-motion-capture
SERVICE_NAME=raspberry-pi-motion-capture
SERVICE_FILE=/etc/systemd/system/raspberry-pi-motion-capture.service

if [ "$(id -un)" != "$EXPECTED_USER" ]; then
  printf 'Run this script as %s, not as root or another user.\n' "$EXPECTED_USER" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLONED_PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
if [ "$CLONED_PROJECT_DIR" = "$PROJECT_DIR" ]; then
  printf '%s\n' "Running from the installed project; updating it without cloning again."
  exec "$PROJECT_DIR/scripts/update.sh"
fi

if [ "$CLONED_PROJECT_DIR" != "$SOURCE_DIR" ]; then
  printf 'Run this script from the clone at %s or installed project at %s; found it at %s.\n' \
    "$SOURCE_DIR" "$PROJECT_DIR" "$CLONED_PROJECT_DIR" >&2
  exit 1
fi

if [ -e "$PROJECT_DIR" ]; then
  if [ -x "$PROJECT_DIR/scripts/update.sh" ]; then
    printf '%s already exists; updating the installed project instead of moving it again.\n' "$PROJECT_DIR"
    exec "$PROJECT_DIR/scripts/update.sh"
  fi
  printf '%s already exists and does not contain the updater; refusing to replace it.\n' "$PROJECT_DIR" >&2
  exit 1
fi

printf '%s\n' "Installing system packages..."
sudo apt-get update
sudo apt-get install -y nodejs npm python3-picamera2 python3-numpy

if ! node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' ; then
  printf '%s\n' "Node.js 18 or newer is required. Install a supported Node.js version, then run this script again." >&2
  exit 1
fi

printf '%s\n' "Moving project to $PROJECT_DIR..."
sudo mv "$SOURCE_DIR" "$PROJECT_DIR"
sudo chown -R "$EXPECTED_USER:$EXPECTED_USER" "$PROJECT_DIR"

cd "$PROJECT_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  printf '%s\n' "Created $PROJECT_DIR/.env; add Lattice settings when ready to sync."
fi

printf '%s\n' "Installing Node dependencies and checking the project..."
npm ci
npm run build
npm test

printf '%s\n' "Installing and starting the systemd service..."
sudo install -m 0644 "$PROJECT_DIR/deploy/raspberry-pi-motion-capture.service" "$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

printf '%s\n' "First-time setup complete. Edit $PROJECT_DIR/.env to enable Lattice sync."
