# Raspberry Pi Motion Capture

Watches a Raspberry Pi CSI camera, saves a 30-second video when it detects motion, and optionally uploads the clip to Lattice as a video attached to a track.

## Install on the Pi

Clone the project into the setup script's expected location, then run it:

```sh
git clone git@github.com:gsopu8065/lattice-sdk-fun.git /home/srujanjs/Documents/code/lattice-sdk-fun
cd /home/srujanjs/Documents/code/lattice-sdk-fun
./scripts/firsttime.sh
```

The script installs system packages, moves the project to `/opt/raspberry-pi-motion-capture`, builds and tests it, then installs and starts the systemd service. It creates `.env` from `.env.example` if needed. It must be run as `srujanjs`. If `/opt/raspberry-pi-motion-capture` already exists, it runs that installation's updater rather than moving or replacing it. You can also run `/opt/raspberry-pi-motion-capture/scripts/firsttime.sh` directly for later updates; no new clone is needed.

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

## Update after a Git push

After committing and pushing changes from your development computer, update the Pi with:

```sh
cd /opt/raspberry-pi-motion-capture
./scripts/update.sh
```

The script pulls the latest fast-forwardable commit, installs Node dependencies, runs the build checks and tests, then restarts the service. It does not change the Pi's ignored `.env` file. If the build or tests fail, it stops before restarting the service.
