#!/bin/sh
set -eu

EXPECTED_USER=srujanjs
MEDIAMTX_VERSION=1.21.2
INSTALL_DIR=/opt/mediamtx
SERVICE_NAME=mediamtx
SERVICE_FILE=/etc/systemd/system/mediamtx.service
MOTION_CAPTURE_SERVICE=raspberry-pi-motion-capture
MOTION_CAPTURE_DIR=/opt/raspberry-pi-motion-capture
LIVE_STREAM_SERVICE=raspberry-pi-live-stream
LIVE_STREAM_SERVICE_FILE=/etc/systemd/system/raspberry-pi-live-stream.service

if [ "$(id -un)" != "$EXPECTED_USER" ]; then
  printf 'Run this script as %s, not as root or another user.\n' "$EXPECTED_USER" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

printf '%s\n' "Freeing the camera: stopping and disabling $MOTION_CAPTURE_SERVICE, if installed..."
if systemctl cat "$MOTION_CAPTURE_SERVICE" >/dev/null 2>&1; then
  sudo systemctl disable --now "$MOTION_CAPTURE_SERVICE"
else
  printf '%s\n' "$MOTION_CAPTURE_SERVICE is not installed; nothing to stop."
fi

printf '%s\n' "Installing ffmpeg (used to relay the live feed to Lattice)..."
sudo apt-get update
sudo apt-get install -y ffmpeg

case "$(uname -m)" in
  aarch64) ARCH=arm64 ;;
  armv7l) ARCH=armv7 ;;
  armv6l) ARCH=armv6 ;;
  x86_64) ARCH=amd64 ;;
  *)
    printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

ARCHIVE="mediamtx_v${MEDIAMTX_VERSION}_linux_${ARCH}.tar.gz"
BASE_URL="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

printf '%s\n' "Downloading MediaMTX v$MEDIAMTX_VERSION for linux/$ARCH..."
curl -fsSL -o "$WORK_DIR/$ARCHIVE" "$BASE_URL/$ARCHIVE"
curl -fsSL -o "$WORK_DIR/checksums.sha256" "$BASE_URL/checksums.sha256"

printf '%s\n' "Verifying checksum..."
(
  cd "$WORK_DIR"
  grep " \*${ARCHIVE}\$" checksums.sha256 > checksum.txt
  sha256sum -c checksum.txt
)

printf '%s\n' "Installing MediaMTX to $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo tar -xzf "$WORK_DIR/$ARCHIVE" -C "$INSTALL_DIR" mediamtx
sudo install -m 0644 "$PROJECT_DIR/deploy/mediamtx.yml" "$INSTALL_DIR/mediamtx.yml"
sudo chown -R "$EXPECTED_USER:$EXPECTED_USER" "$INSTALL_DIR"

printf '%s\n' "Installing and starting the systemd service..."
sudo install -m 0644 "$PROJECT_DIR/deploy/mediamtx.service" "$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

printf '%s\n' "MediaMTX installed. Verify the camera feed locally with, e.g.:"
printf '%s\n' "  ffplay rtsp://<pi-ip>:8554/raspberry-pi-motion-live"
printf '%s\n' "Logs: sudo journalctl -u $SERVICE_NAME -f"
printf '%s\n' "$MOTION_CAPTURE_SERVICE has been stopped and disabled so MediaMTX can use the camera."
printf '%s\n' "Re-enable it later with: sudo systemctl enable --now $MOTION_CAPTURE_SERVICE"

if [ -f "$MOTION_CAPTURE_DIR/src/livestream.js" ]; then
  printf '%s\n' "Installing and starting the live stream relay to Lattice..."
  sudo install -m 0644 "$PROJECT_DIR/deploy/raspberry-pi-live-stream.service" "$LIVE_STREAM_SERVICE_FILE"
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$LIVE_STREAM_SERVICE"
  sudo systemctl --no-pager --full status "$LIVE_STREAM_SERVICE"
  printf '%s\n' "Logs: sudo journalctl -u $LIVE_STREAM_SERVICE -f"
else
  printf '%s\n' "$MOTION_CAPTURE_DIR/src/livestream.js not found; skipping the live stream relay service."
  printf '%s\n' "Install the main app there first (scripts/firsttime.sh), then re-run this script."
fi
