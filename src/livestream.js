require("dotenv").config();

const { loadConfig } = require("./config");
const { createLiveStreamManager } = require("./lattice");

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Unable to start the live stream relay: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!config.latticeEnabled) {
    console.log("Lattice credentials are not configured; there is no live stream to relay.");
    return;
  }

  console.log(`Relaying ${config.liveStreamSourceUrl} to Lattice as a live stream for ${config.cameraName}.`);
  const liveStream = createLiveStreamManager(config);
  liveStream.start();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      liveStream.stop();
      process.exit(0);
    });
  }
}

if (require.main === module) {
  main();
}
