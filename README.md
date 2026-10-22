# Raspberry Pi Motion Capture

Watches a Raspberry Pi camera and sends video to Lattice two ways:

1. **Clips** — saves a 30-second video on motion (or every 5 min if idle), uploads it, and publishes a track entity.
2. **Live stream** — relays the camera to Lattice as a live SRT feed via MediaMTX.

Only one of these can use the camera at a time.

```
Pi Camera
   │
   ├─(1) Picamera2 ──────────────► clip files ──► upload ──► Lattice track entity
   │     (raspberry-pi-motion-capture.service)
   │
   └─(2) MediaMTX ──RTSP──► ffmpeg relay ──SRT──► Lattice ingress stream + live entity
         (mediamtx.service)   (raspberry-pi-live-stream.service)
```

## Install

```sh
git clone git@github.com:gsopu8065/lattice-sdk-fun.git /home/srujanjs/Documents/code/lattice-sdk-fun
cd /home/srujanjs/Documents/code/lattice-sdk-fun
./scripts/firsttime.sh
```

Installs everything, moves the project to `/opt/raspberry-pi-motion-capture`, and starts clip recording (mode 1) as a service. Must be run as `srujanjs`.

Edit `/opt/raspberry-pi-motion-capture/.env` to enable Lattice sync (`LATTICE_ENDPOINT`, `ENVIRONMENT_TOKEN`), then:

```sh
sudo systemctl restart raspberry-pi-motion-capture
```

Without those set, clips are just stored locally in `videos/` (newest 20 kept).

## Switch to the live stream

```sh
cd /opt/raspberry-pi-motion-capture
./scripts/install-mediamtx.sh
```

Stops clip recording (frees the camera), installs MediaMTX + ffmpeg, and starts the live-stream relay. Requires `.env` to have Lattice credentials set.

Logs: `sudo journalctl -u mediamtx -f` or `-u raspberry-pi-live-stream -f`.

Switch back: `sudo systemctl disable --now mediamtx raspberry-pi-live-stream && sudo systemctl enable --now raspberry-pi-motion-capture`.

## Update after a push

```sh
cd /opt/raspberry-pi-motion-capture
./scripts/update.sh
```

Pulls, rebuilds, and restarts whichever service(s) are currently enabled.
