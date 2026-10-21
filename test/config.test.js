const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../src/config");
const { createTrackEntity, trackIdForClip } = require("../src/lattice");
const { isSynced, markSynced, pruneVideos } = require("../src/storage");

test("uses defaults and resolves the video directory", () => {
  const config = loadConfig({}, "/tmp/motion-app");

  assert.equal(config.outputDirectory, "/tmp/motion-app/videos");
  assert.equal(config.latticeEnabled, false);
  assert.equal(config.cameraLatitude, 47.79260824681428);
  assert.equal(config.cameraLongitude, -122.27106065201278);
  assert.equal(config.maxVideos, 20);
  assert.equal(config.clipSeconds, 30);
  assert.equal(config.motionThreshold, 0.04);
  assert.equal(config.pixelThreshold, 25);
  assert.equal(config.fps, 15);
});

test("accepts supported environment overrides", () => {
  const config = loadConfig(
    {
      VIDEO_DIR: "/mnt/camera-clips",
      LATTICE_ENDPOINT: "https://lattice.example",
      ENVIRONMENT_TOKEN: "environment-token",
      SANDBOXES_TOKEN: "sandbox-token",
      CAMERA_NAME: "Front porch",
      CAMERA_LATITUDE: "47.5",
      CAMERA_LONGITUDE: "-122.5",
      MAX_VIDEOS: "12",
      CLIP_SECONDS: "45",
      MOTION_THRESHOLD: "0.08",
      PIXEL_THRESHOLD: "30",
      CAMERA_FPS: "20",
    },
    "/tmp/motion-app",
  );

  assert.equal(config.outputDirectory, "/mnt/camera-clips");
  assert.equal(config.latticeEndpoint, "https://lattice.example");
  assert.equal(config.environmentToken, "environment-token");
  assert.equal(config.sandboxToken, "sandbox-token");
  assert.equal(config.latticeEnabled, true);
  assert.equal(config.cameraName, "Front porch");
  assert.equal(config.cameraLatitude, 47.5);
  assert.equal(config.cameraLongitude, -122.5);
  assert.equal(config.maxVideos, 12);
  assert.equal(config.clipSeconds, 45);
  assert.equal(config.motionThreshold, 0.08);
  assert.equal(config.pixelThreshold, 30);
  assert.equal(config.fps, 20);
});

test("rejects invalid values instead of silently falling back", () => {
  assert.throws(() => loadConfig({ CLIP_SECONDS: "0" }), /CLIP_SECONDS/);
  assert.throws(
    () => loadConfig({ MOTION_THRESHOLD: "not-a-number" }),
    /MOTION_THRESHOLD/,
  );
  const partialCredentials = loadConfig({ LATTICE_ENDPOINT: "https://lattice.example" });
  assert.equal(partialCredentials.latticeEnabled, false);
  assert.equal(partialCredentials.latticeCredentialsIncomplete, true);
  const sandboxWithoutEnvironmentToken = loadConfig({
    LATTICE_ENDPOINT: "https://lattice.example",
    SANDBOXES_TOKEN: "sandbox-token",
  });
  assert.equal(sandboxWithoutEnvironmentToken.latticeEnabled, false);
  assert.throws(() => loadConfig({ CAMERA_LATITUDE: "91" }), /CAMERA_LATITUDE/);
});

test("builds a Lattice track entity linked to the uploaded clip", () => {
  const config = loadConfig({
    LATTICE_ENDPOINT: "https://lattice.example",
    ENVIRONMENT_TOKEN: "environment-token",
    CAMERA_NAME: "Front porch",
  });
  const capturedAt = new Date("2026-10-21T21:00:00.000Z");
  const entity = createTrackEntity(
    "/tmp/motion-20261021-210000.h264",
    config,
    capturedAt,
    "track-123",
  );

  assert.equal(entity.entityId, "track-123");
  assert.equal(entity.ontology.template, "TEMPLATE_TRACK");
  assert.deepEqual(entity.location.position, {
    latitudeDegrees: 47.79260824681428,
    longitudeDegrees: -122.27106065201278,
  });
  assert.deepEqual(entity.media.media[0], {
    itemIdentifier: "track-123",
    type: "MEDIA_TYPE_VIDEO",
    relativePath: "raspberry-pi-motion/motion-20261021-210000.h264",
  });
  assert.equal(entity.provenance.sourceUpdateTime, capturedAt.toISOString());
  assert.equal(
    trackIdForClip("/tmp/motion-20261021-210000.h264"),
    trackIdForClip("/another/path/motion-20261021-210000.h264"),
  );
});

test("keeps only the newest videos and removes sync markers with old clips", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "motion-capture-"));
  try {
    const filePaths = [];
    for (const [index, name] of ["oldest.h264", "middle.h264", "newest.h264"].entries()) {
      const filePath = path.join(directory, name);
      await fs.writeFile(filePath, name);
      const modifiedAt = new Date(Date.UTC(2020, 0, index + 1));
      await fs.utimes(filePath, modifiedAt, modifiedAt);
      filePaths.push(filePath);
    }
    await markSynced(filePaths[0]);
    assert.equal(await isSynced(filePaths[0]), true);

    const removed = await pruneVideos(directory, 2);

    assert.deepEqual(removed, [filePaths[0]]);
    await assert.rejects(fs.access(filePaths[0]), { code: "ENOENT" });
    await assert.rejects(fs.access(`${filePaths[0]}.synced`), { code: "ENOENT" });
    assert.equal(await isSynced(filePaths[1]), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
