# Raspberry Pi Motion Capture

Watches a Raspberry Pi CSI camera, saves a 30-second video when it detects motion, and optionally uploads the clip to Lattice as a video attached to a track. If no motion is detected for 5 minutes, it saves a 30-second fallback clip; fallback recording repeats every 5 minutes until motion is detected.

## Install on the Pi

Clone the project into the setup script's expected location, then run it:

```sh
git clone git@github.com:gsopu8065/lattice-sdk-fun.git /home/srujanjs/Documents/code/lattice-sdk-fun
cd /home/srujanjs/Documents/code/lattice-sdk-fun
./scripts/firsttime.sh
```

The script installs system packages, moves the project to `/opt/raspberry-pi-motion-capture`, builds it, then installs and starts the systemd service. It creates `.env` from `.env.example` if needed. It must be run as `srujanjs`. If `/opt/raspberry-pi-motion-capture` already exists, it runs that installation's updater rather than moving or replacing it. You can also run `/opt/raspberry-pi-motion-capture/scripts/firsttime.sh` directly for later updates; no new clone is needed.

After setup, edit the installed app's environment file:

```sh
nano /opt/raspberry-pi-motion-capture/.env
```

Set `LATTICE_ENDPOINT` and `ENVIRONMENT_TOKEN` to enable Lattice sync. Set `SANDBOXES_TOKEN` only when using a sandbox. Save in nano with **Ctrl+O**, **Enter**, then **Ctrl+X**. Restart the service so it loads the new values:

```sh
sudo systemctl restart raspberry-pi-motion-capture
```

`.env` uses the same three Lattice settings as the Lattice gRPC learning project:

```dotenv
SANDBOXES_TOKEN=
LATTICE_ENDPOINT=
ENVIRONMENT_TOKEN=
```

Fill in `LATTICE_ENDPOINT` and `ENVIRONMENT_TOKEN` to enable uploads. `SANDBOXES_TOKEN` is only needed when using a sandbox. Keep `.env` private; it is excluded from Git.

If those values are blank, the app still monitors the camera and stores clips locally in `videos/`. It keeps at most 20 videos, deleting the oldest first. After adding credentials, restart the app; saved clips will sync to Lattice.

Your camera location is already set to `47.79260824681428, -122.27106065201278`. Edit `CAMERA_LATITUDE` and `CAMERA_LONGITUDE` in `.env` only if you want to change it.

Optional settings can also be added to `.env`: `NO_MOTION_INTERVAL=300` sets the fallback interval in seconds (five minutes by default), and `MOTION_THRESHOLD=0.005` / `PIXEL_THRESHOLD=10` make motion detection more sensitive. Restart the service after changing settings.

## Run

To run manually instead of using the service:

```sh
cd /opt/raspberry-pi-motion-capture
npm run build
npm start
```

Stop with `Ctrl+C`. Videos are H.264 files. To see logs while running as a service:

```sh
sudo journalctl -u raspberry-pi-motion-capture -f
```

When you change `.env`, restart the service to load the new values:

```sh
sudo systemctl restart raspberry-pi-motion-capture
```

## Live video streaming (MediaMTX)

In addition to motion-triggered clips, the camera can be relayed to Lattice as a live SRT feed. This uses [MediaMTX](https://github.com/bluenviron/mediamtx) to read the Pi camera and serve it locally, plus a small relay process that pushes that feed on to Lattice.

Only one process can read the Pi camera at a time, so install MediaMTX with:

```sh
cd /opt/raspberry-pi-motion-capture
./scripts/install-mediamtx.sh
```

This script stops and disables `raspberry-pi-motion-capture` (freeing the camera), installs MediaMTX and `ffmpeg`, and starts two services:

- `mediamtx` — reads the Pi camera directly and serves it locally at `rtsp://<pi-ip>:8554/raspberry-pi-motion-live` (verify with `ffplay`).
- `raspberry-pi-live-stream` — pulls that local feed and relays it to a Lattice SRT ingress stream, publishing a live entity for it. Only runs when `LATTICE_ENDPOINT`/`ENVIRONMENT_TOKEN` are set in `.env`.

Logs: `sudo journalctl -u mediamtx -f` and `sudo journalctl -u raspberry-pi-live-stream -f`.

To go back to motion-triggered clip recording instead of the live feed: `sudo systemctl disable --now mediamtx raspberry-pi-live-stream && sudo systemctl enable --now raspberry-pi-motion-capture`.

Optional `.env` settings: `LIVE_STREAM_SOURCE_URL` (default `rtsp://127.0.0.1:8554/raspberry-pi-motion-live`) and `LIVE_STREAM_REFRESH_INTERVAL` (seconds between re-publishing the live entity, default 300).

## Update after a Git push

After committing and pushing changes from your development computer, update the Pi with:

```sh
cd /opt/raspberry-pi-motion-capture
./scripts/update.sh
```

The script pulls the latest fast-forwardable commit, installs Node dependencies, runs the build checks, then restarts the service. It does not change the Pi's ignored `.env` file. If the build fails, it stops before restarting the service.
