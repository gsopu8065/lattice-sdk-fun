require("dotenv").config();

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { loadConfig } = require("./config");
const { createLatticeUploader } = require("./lattice");
const { isSynced, listVideos, markSynced, pruneVideos } = require("./storage");

function main() {
  let config;
  try {
    config = loadConfig();
    fs.mkdirSync(config.outputDirectory, { recursive: true });
  } catch (error) {
    console.error(`Unable to start motion capture: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const uploadClip = config.latticeEnabled ? createLatticeUploader(config) : null;
  if (!uploadClip) {
    console.log("Lattice credentials are not configured; clips will be stored locally.");
  }
  const startupCleanup = pruneVideos(config.outputDirectory, config.maxVideos)
    .then((removed) => {
      for (const filePath of removed) {
        console.warn(`Removed old clip to enforce the ${config.maxVideos}-video storage limit: ${filePath}`);
      }
    });
  startupCleanup.catch((error) => {
    console.error(`Unable to enforce the local video limit: ${error.message}`);
    process.exitCode = 1;
  });
  if (config.latticeCredentialsIncomplete) {
    console.warn("Both LATTICE_ENDPOINT and ENVIRONMENT_TOKEN are required for sync; clips will be stored locally.");
  }

  let syncRunning = false;
  let syncRequested = false;
  const inFlight = new Set();

  async function syncLocalVideos() {
    if (!uploadClip) {
      return;
    }
    if (syncRunning) {
      syncRequested = true;
      return;
    }

    syncRunning = true;
    try {
      await startupCleanup;
      do {
        syncRequested = false;
        const videos = await listVideos(config.outputDirectory);
        for (const { filePath } of videos) {
          if (inFlight.has(filePath) || await isSynced(filePath)) {
            continue;
          }

          inFlight.add(filePath);
          try {
            const { entityId, objectPath } = await uploadClip(filePath);
            await markSynced(filePath);
            console.log(`Uploaded ${filePath} and published Lattice track ${entityId} (${objectPath}).`);
          } catch (error) {
            console.error(`Unable to upload ${filePath} or publish its Lattice track: ${error.message}`);
          } finally {
            inFlight.delete(filePath);
            const removed = await pruneVideos(
              config.outputDirectory,
              config.maxVideos,
              inFlight,
            );
            for (const removedPath of removed) {
              console.warn(`Removed old clip to enforce the ${config.maxVideos}-video storage limit: ${removedPath}`);
            }
          }
        }
        const removed = await pruneVideos(config.outputDirectory, config.maxVideos, inFlight);
        for (const filePath of removed) {
          console.warn(`Removed old clip to enforce the ${config.maxVideos}-video storage limit: ${filePath}`);
        }
      } while (syncRequested);
    } catch (error) {
      console.error(`Unable to sync local clips: ${error.message}`);
    } finally {
      syncRunning = false;
    }
  }

  const helper = path.resolve(__dirname, "../camera/motion_capture.py");
  const args = [
    helper,
    "--output-dir",
    config.outputDirectory,
    "--clip-seconds",
    String(config.clipSeconds),
    "--no-motion-interval",
    String(config.noMotionInterval),
    "--motion-threshold",
    String(config.motionThreshold),
    "--pixel-threshold",
    String(config.pixelThreshold),
    "--fps",
    String(config.fps),
  ];

  console.log(`Watching for motion. Videos will be saved in ${config.outputDirectory}`);
  if (uploadClip) {
    console.log(`Motion events will be published for ${config.cameraName} to Lattice.`);
  }
  const cameraProcess = spawn(config.python, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: cameraProcess.stdout });
  let stopping = false;

  output.on("line", (line) => {
    const savedClipPrefix = "CLIP_SAVED\t";
    if (line.startsWith(savedClipPrefix)) {
      if (uploadClip) {
        void syncLocalVideos();
      } else {
        void startupCleanup
          .then(() => pruneVideos(config.outputDirectory, config.maxVideos))
          .then((removed) => {
            for (const filePath of removed) {
              console.warn(`Removed old clip to enforce the ${config.maxVideos}-video storage limit: ${filePath}`);
            }
          })
          .catch((error) => console.error(`Unable to enforce the local video limit: ${error.message}`));
      }
      return;
    }

    console.log(line);
  });
  cameraProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));

  cameraProcess.once("error", (error) => {
    console.error(`Unable to start the camera helper: ${error.message}`);
    process.exitCode = 1;
  });

  if (uploadClip) {
    void syncLocalVideos();
    const retryTimer = setInterval(() => void syncLocalVideos(), 60_000);
    retryTimer.unref();
  }

  cameraProcess.once("close", async (code, signal) => {
    output.close();
    if (signal && !stopping) {
      console.error(`Camera helper exited after signal ${signal}.`);
      process.exitCode = 1;
    } else if (code !== 0 && code !== null) {
      console.error(`Camera helper exited with code ${code}.`);
      process.exitCode = code;
    }
    await syncLocalVideos();
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      stopping = true;
      if (cameraProcess.exitCode === null && cameraProcess.signalCode === null) {
        cameraProcess.kill(signal);
      }
    });
  }
}

if (require.main === module) {
  main();
}
