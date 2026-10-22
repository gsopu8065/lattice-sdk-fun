const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { LatticeClient } = require("@anduril-industries/lattice-sdk");

const ENTITY_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RELAY_RETRY_DELAY_MS = 30_000;
const LIVESTREAM_INGRESS_ID = "raspberry-pi-motion-livestream";

function createClient(config) {
  const clientOptions = {
    baseUrl: config.latticeEndpoint,
    token: config.environmentToken,
  };
  if (config.sandboxToken) {
    clientOptions.headers = {
      "anduril-sandbox-authorization": `Bearer ${config.sandboxToken}`,
    };
  }
  return new LatticeClient(clientOptions);
}

function deterministicEntityId(key) {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function trackIdForClip(filePath) {
  return deterministicEntityId(path.basename(filePath));
}

function isObjectAlreadyExistsError(error) {
  return (
    error?.statusCode === 400 &&
    typeof error.body?.message === "string" &&
    error.body.message.includes("already exists")
  );
}

function isIngressStreamConflictError(error) {
  return error?.statusCode === 409;
}

function createTrackEntity(filePath, config, capturedAt, entityId) {
  const filename = path.basename(filePath);

  return {
    entityId,
    description: `Motion detected by ${config.cameraName}; video: ${filename}`,
    isLive: true,
    createdTime: capturedAt.toISOString(),
    expiryTime: new Date(capturedAt.getTime() + ENTITY_EXPIRY_MS).toISOString(),
    aliases: {
      name: `${config.cameraName} motion event`,
    },
    milView: {
      disposition: "DISPOSITION_FRIENDLY",
      environment: "ENVIRONMENT_LAND",
    },
    location: {
      position: {
        latitudeDegrees: config.cameraLatitude,
        longitudeDegrees: config.cameraLongitude,
      },
    },
    ontology: {
      platformType: "Camera motion event",
      specificType: "Raspberry Pi camera motion detection",
      template: "TEMPLATE_TRACK",
    },
    media: {
      media: [
        {
          itemIdentifier: entityId,
          type: "MEDIA_TYPE_VIDEO",
          relativePath: `raspberry-pi-motion/${filename}`,
        },
      ],
    },
    provenance: {
      integrationName: "Raspberry Pi Motion Capture",
      dataType: "CAMERA_MOTION",
      sourceId: filename,
      sourceUpdateTime: capturedAt.toISOString(),
      sourceDescription: config.cameraName,
    },
  };
}

function createLiveStreamEntity(config, srt, entityId, capturedAt) {
  return {
    entityId,
    description: srt?.url
      ? `Live video stream from ${config.cameraName}; SRT ingest: ${srt.url}`
      : `Live video stream from ${config.cameraName}`,
    isLive: true,
    createdTime: capturedAt.toISOString(),
    expiryTime: new Date(capturedAt.getTime() + ENTITY_EXPIRY_MS).toISOString(),
    aliases: {
      name: `${config.cameraName} live stream`,
    },
    milView: {
      disposition: "DISPOSITION_FRIENDLY",
      environment: "ENVIRONMENT_LAND",
    },
    location: {
      position: {
        latitudeDegrees: config.cameraLatitude,
        longitudeDegrees: config.cameraLongitude,
      },
    },
    ontology: {
      platformType: "Camera live stream",
      specificType: "Raspberry Pi camera live video feed",
      template: "TEMPLATE_TRACK",
    },
    media: srt?.url
      ? {
          media: [
            {
              itemIdentifier: entityId,
              type: "MEDIA_TYPE_VIDEO",
              relativePath: srt.url,
            },
          ],
        }
      : undefined,
    provenance: {
      integrationName: "Raspberry Pi Motion Capture",
      dataType: "CAMERA_LIVE_VIDEO",
      sourceId: LIVESTREAM_INGRESS_ID,
      sourceUpdateTime: capturedAt.toISOString(),
      sourceDescription: config.cameraName,
    },
  };
}

function createLatticeUploader(config) {
  const client = createClient(config);

  return async function uploadClip(filePath) {
    const entityId = trackIdForClip(filePath);
    const capturedAt = new Date();
    const objectPath = `raspberry-pi-motion/${path.basename(filePath)}`;

    try {
      await client.objects.uploadObject(createReadStream(filePath), objectPath);
    } catch (error) {
      if (!isObjectAlreadyExistsError(error)) {
        throw error;
      }
      console.log(`Object ${objectPath} was already uploaded; skipping re-upload.`);
    }
    await client.entities.publishEntity(createTrackEntity(filePath, config, capturedAt, entityId));

    return { entityId, objectPath };
  };
}

// Independent of clip uploads: keeps one Lattice SRT ingress stream alive, publishes a
// "live" entity pointing at it, and supervises the ffmpeg process that relays MediaMTX's
// local feed into that ingress stream. Runs as its own process (see src/livestream.js)
// so it works regardless of whether the motion-capture service is enabled.
function createLiveStreamManager(config) {
  const client = createClient(config);
  const liveStreamEntityId = deterministicEntityId(`${config.cameraName}-livestream`);

  let liveStreamPromise = null;
  let refreshTimer = null;
  let relayProcess = null;
  let relayRetryTimer = null;
  let stopping = false;

  async function createOrFetchLiveStream() {
    try {
      const response = await client.video.createIngressStream({
        ingressId: LIVESTREAM_INGRESS_ID,
        title: `${config.cameraName} live stream`,
        srt: {},
      });
      console.log(`Created Lattice live ingress stream ${LIVESTREAM_INGRESS_ID}.`);
      return response.srt;
    } catch (error) {
      if (!isIngressStreamConflictError(error)) {
        throw error;
      }
      const existing = await client.video.getIngressStream({ ingressId: LIVESTREAM_INGRESS_ID });
      return existing.ingressStream?.srt;
    }
  }

  async function ensureLiveStream() {
    if (!liveStreamPromise) {
      liveStreamPromise = createOrFetchLiveStream().catch((error) => {
        liveStreamPromise = null;
        throw error;
      });
    }
    return liveStreamPromise;
  }

  async function publishLiveStreamEntity() {
    const srt = await ensureLiveStream();
    await client.entities.publishEntity(createLiveStreamEntity(config, srt, liveStreamEntityId, new Date()));
  }

  function scheduleRelayRetry() {
    if (stopping || relayRetryTimer) {
      return;
    }
    relayRetryTimer = setTimeout(() => {
      relayRetryTimer = null;
      void startRelay();
    }, RELAY_RETRY_DELAY_MS);
  }

  function spawnRelay(srtUrl) {
    console.log(`Starting live stream relay: ${config.liveStreamSourceUrl} -> Lattice SRT ingress.`);
    relayProcess = spawn(
      "ffmpeg",
      ["-loglevel", "error", "-i", config.liveStreamSourceUrl, "-c", "copy", "-f", "mpegts", srtUrl],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    relayProcess.stderr.on("data", (chunk) => process.stderr.write(`[live-stream-relay] ${chunk}`));
    relayProcess.once("error", (error) => {
      relayProcess = null;
      console.error(`Unable to start the live stream relay (ffmpeg): ${error.message}`);
      scheduleRelayRetry();
    });
    relayProcess.once("exit", (code, signal) => {
      relayProcess = null;
      if (stopping) {
        return;
      }
      console.error(`Live stream relay exited (code=${code}, signal=${signal}); retrying in ${RELAY_RETRY_DELAY_MS / 1000}s.`);
      scheduleRelayRetry();
    });
  }

  async function startRelay() {
    if (stopping || relayProcess) {
      return;
    }
    try {
      const srt = await ensureLiveStream();
      if (!srt?.url) {
        throw new Error("Lattice did not return an SRT url for the ingress stream.");
      }
      spawnRelay(srt.url);
    } catch (error) {
      console.error(`Unable to start the live stream relay: ${error.message}`);
      scheduleRelayRetry();
    }
  }

  function start() {
    void startRelay();
    void publishLiveStreamEntity().catch((error) =>
      console.error(`Unable to publish the live stream entity: ${error.message}`),
    );
    refreshTimer = setInterval(() => {
      void publishLiveStreamEntity().catch((error) =>
        console.error(`Unable to publish the live stream entity: ${error.message}`),
      );
    }, config.liveStreamRefreshInterval * 1000);
    refreshTimer.unref();
  }

  function stop() {
    stopping = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (relayRetryTimer) {
      clearTimeout(relayRetryTimer);
      relayRetryTimer = null;
    }
    if (relayProcess) {
      relayProcess.kill("SIGTERM");
    }
  }

  return { start, stop };
}

module.exports = {
  createLatticeUploader,
  createLiveStreamManager,
  createTrackEntity,
  createLiveStreamEntity,
  trackIdForClip,
};
