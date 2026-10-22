const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { LatticeClient } = require("@anduril-industries/lattice-sdk");

const ENTITY_EXPIRY_MS = 24 * 60 * 60 * 1000;

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

function trackIdForClip(filePath) {
  const hex = createHash("sha256").update(path.basename(filePath)).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isObjectAlreadyExistsError(error) {
  return (
    error?.statusCode === 400 &&
    typeof error.body?.message === "string" &&
    error.body.message.includes("already exists")
  );
}

function createLatticeUploader(config) {
  const clientOptions = {
    baseUrl: config.latticeEndpoint,
    token: config.environmentToken,
  };
  if (config.sandboxToken) {
    clientOptions.headers = {
      "anduril-sandbox-authorization": `Bearer ${config.sandboxToken}`,
    };
  }

  const client = new LatticeClient(clientOptions);

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
    }
    await client.entities.publishEntity(createTrackEntity(filePath, config, capturedAt, entityId));
    return { entityId, objectPath };
  };
}

module.exports = { createLatticeUploader, createTrackEntity, trackIdForClip };
