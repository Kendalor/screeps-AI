// Regenerates the pserver's per-room map-view PNGs (server/assets/map/*.png
// and the merged 4x4 server/assets/map/zoom2/*.png tiles) to match whatever
// room set is currently in server/db.json, and deletes any stale PNGs left
// over from a previous room grid.
//
// These assets are NOT part of db.json and NOT touched by `reset:server` --
// they're static files the backend serves directly for the world map view.
// bake-world-block.mjs rebuilds the room grid but can't regenerate them
// itself (that requires a live server, via the admin CLI's
// map.updateRoomImageAssets, whereas the bake only writes seed JSON to
// disk). Run this AFTER `npm run reset:server` + starting `watch:server`
// with a rebuilt world, or the map view will show stale terrain images
// (old rooms) and blank/missing tiles (new rooms) even though the
// underlying terrain data is correct.
//
// Usage (server must be running):
//   npm run watch:server   (in one terminal)
//   node scripts/regen-map-assets.mjs   (in another)
import net from "node:net";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const HOST = "localhost";
const PORT = 21026;
const SEED_FILE = path.join("server", "seed-expanded.json");
const MAP_DIR = path.join("server", "assets", "map");
const ZOOM2_DIR = path.join(MAP_DIR, "zoom2");

if (!existsSync(SEED_FILE)) {
  console.error(`Cannot find ${SEED_FILE} -- run scripts/bake-world-block.mjs first.`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(SEED_FILE, "utf8"));
const rooms = seed.collections.find(c => c.name === "rooms");
const roomNames = rooms.data.map(r => r._id);
const validNames = new Set(roomNames);

// Clean up stale PNGs from whatever room grid was there before -- nothing
// of a prior map should be left rendering on the client's map view.
let removed = 0;
if (existsSync(MAP_DIR)) {
  for (const f of readdirSync(MAP_DIR)) {
    if (!f.endsWith(".png")) continue;
    const roomName = f.replace(/\.png$/, "");
    if (!validNames.has(roomName)) {
      unlinkSync(path.join(MAP_DIR, f));
      removed++;
    }
  }
}
if (existsSync(ZOOM2_DIR)) {
  for (const f of readdirSync(ZOOM2_DIR)) {
    unlinkSync(path.join(ZOOM2_DIR, f));
  }
}
console.log(`Removed ${removed} stale room PNG(s) and cleared zoom2 cache.`);

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onError = err => { cleanup(); reject(err); };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for CLI response")); }, 15000);
    const onData = data => {
      output += data.toString("utf8");
      if (!output.endsWith("\r\n")) return;
      cleanup();
      resolve(output);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// map.updateRoomImageAssets doesn't send a CLI reply frame the way
// map.generateRoom does (its promise chain isn't serialized back to the
// socket), so we can't wait for a per-command response -- fire each
// command with fixed spacing and let the async PNG writes happen on the
// server in the background.
const socket = net.connect(PORT, HOST);

socket.on("connect", async () => {
  try {
    await readReply(socket);
    console.log(`Connected. Regenerating map image assets for ${roomNames.length} room(s)...`);
    for (let i = 0; i < roomNames.length; i++) {
      const roomName = roomNames[i];
      socket.write(`map.updateRoomImageAssets("${roomName}")\r\n`);
      await sleep(150);
      if ((i + 1) % 20 === 0 || i === roomNames.length - 1) {
        console.log(`[${i + 1}/${roomNames.length}] commands sent`);
      }
    }
    // Give the last batch of async PNG writes time to finish server-side.
    await sleep(5000);
  } catch (err) {
    console.error("CLI command failed:", err);
    process.exitCode = 1;
  } finally {
    console.log("Done. Map view should now match the current room set.");
    socket.end();
  }
});

socket.on("error", err => {
  console.error(`Could not connect to admin CLI on ${HOST}:${PORT}: ${err.message}`);
  console.error("Is the server running (`npm run watch:server`)?");
  process.exit(1);
});
