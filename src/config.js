const path = require("node:path");

function readNumber(env, name, fallback, { integer = false, min, max } = {}) {
  const raw = env[name];
  if (raw !== undefined && raw.trim() === "") {
    throw new Error(`${name} must not be empty.`);
  }
  const value = raw === undefined ? fallback : Number(raw);

  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? "an integer" : "a number"}.`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${name} must be at least ${min}.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be at most ${max}.`);
  }

  return value;
}

function loadConfig(env = process.env, cwd = process.cwd()) {
  const outputDirectory = env.VIDEO_DIR || "videos";
  const python = env.PYTHON || "python3";
  const latticeEndpoint = env.LATTICE_ENDPOINT;
  const environmentToken = env.ENVIRONMENT_TOKEN;
  const sandboxToken = env.SANDBOXES_TOKEN;
  const cameraName = env.CAMERA_NAME || "Raspberry Pi Camera";

  if (!outputDirectory.trim()) {
    throw new Error("VIDEO_DIR must not be empty.");
  }
  if (!python.trim()) {
    throw new Error("PYTHON must not be empty.");
  }
  if (!cameraName.trim()) {
    throw new Error("CAMERA_NAME must not be empty.");
  }
  return {
    outputDirectory: path.resolve(cwd, outputDirectory),
    python,
    latticeEndpoint: latticeEndpoint?.trim() || undefined,
    environmentToken: environmentToken?.trim() || undefined,
    sandboxToken: sandboxToken?.trim() || undefined,
    latticeEnabled: Boolean(latticeEndpoint?.trim() && environmentToken?.trim()),
    latticeCredentialsIncomplete: Boolean(latticeEndpoint?.trim()) !== Boolean(environmentToken?.trim()),
    cameraName: cameraName.trim(),
    cameraLatitude: readNumber(env, "CAMERA_LATITUDE", 47.79260824681428, {
      min: -90,
      max: 90,
    }),
    cameraLongitude: readNumber(env, "CAMERA_LONGITUDE", -122.27106065201278, {
      min: -180,
      max: 180,
    }),
    maxVideos: readNumber(env, "MAX_VIDEOS", 20, {
      integer: true,
      min: 1,
      max: 1000,
    }),
    clipSeconds: readNumber(env, "CLIP_SECONDS", 30, {
      integer: true,
      min: 1,
      max: 3600,
    }),
    motionThreshold: readNumber(env, "MOTION_THRESHOLD", 0.04, {
      min: 0.001,
      max: 1,
    }),
    pixelThreshold: readNumber(env, "PIXEL_THRESHOLD", 25, {
      integer: true,
      min: 1,
      max: 255,
    }),
    fps: readNumber(env, "CAMERA_FPS", 15, {
      integer: true,
      min: 1,
      max: 60,
    }),
  };
}

module.exports = { loadConfig };
