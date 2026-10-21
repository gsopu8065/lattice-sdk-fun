# Raspberry Pi Motion Capture

Watches a Raspberry Pi CSI camera, saves a 30-second video when it detects motion, and optionally uploads the clip to Lattice as a video attached to a track.

## Install on the Pi

```sh
sudo apt update
sudo apt install -y nodejs npm python3-picamera2 python3-numpy
cd /opt/raspberry-pi-motion-capture
npm ci
cp .env.example .env
nano .env
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

```sh
npm run build
npm start
```

Stop with `Ctrl+C`. Videos are H.264 files. To see logs while running as a service:

```sh
sudo journalctl -u raspberry-pi-motion-capture -f
```

## Run on startup (optional)

The included systemd service is configured for your Pi username `srujanjs` and assumes the project is installed at `/opt/raspberry-pi-motion-capture`. Update the paths in `deploy/raspberry-pi-motion-capture.service` if needed, then run:

```sh
sudo chown -R srujanjs:srujanjs /opt/raspberry-pi-motion-capture
sudo install -m 0644 deploy/raspberry-pi-motion-capture.service /etc/systemd/system/raspberry-pi-motion-capture.service
sudo systemctl daemon-reload
sudo systemctl enable --now raspberry-pi-motion-capture
```

When you change `.env`, restart the service to load the new values:

```sh
sudo systemctl restart raspberry-pi-motion-capture
```
