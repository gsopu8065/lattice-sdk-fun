const fs = require("node:fs/promises");
const path = require("node:path");

const VIDEO_EXTENSION = ".h264";

async function listVideos(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const videos = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(VIDEO_EXTENSION))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fs.stat(filePath);
        return { filePath, modifiedAt: stats.mtimeMs };
      }),
  );

  return videos.sort((left, right) => left.modifiedAt - right.modifiedAt);
}

async function pruneVideos(directory, maxVideos, protectedPaths = new Set()) {
  const videos = await listVideos(directory);
  let excess = videos.length - maxVideos;
  if (excess <= 0) {
    return [];
  }

  const removed = [];
  for (const video of videos) {
    if (excess === 0) {
      break;
    }
    if (protectedPaths.has(video.filePath)) {
      continue;
    }
    await fs.rm(video.filePath);
    await fs.rm(`${video.filePath}.synced`, { force: true });
    removed.push(video.filePath);
    excess -= 1;
  }

  return removed;
}

async function isSynced(filePath) {
  try {
    await fs.access(`${filePath}.synced`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function markSynced(filePath) {
  await fs.writeFile(`${filePath}.synced`, "Synced to Lattice\n", { flag: "w" });
}

module.exports = { isSynced, listVideos, markSynced, pruneVideos };
