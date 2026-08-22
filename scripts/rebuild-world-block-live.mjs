// Rebuilds the LOCAL PSERVER's room grid as an exact, grid-aligned copy of a
// block of rooms from the real Screeps World server (screeps.com) -- same
// room names, same terrain, same sources/minerals/controllers/keeper lairs,
// same highway/SK layout, because the pserver and the World share the same
// room-name <-> (x,y) convention (see scripts/lib/roomGrid.mjs).
//
// Unlike an earlier version of this script, this does NOT hand-write
// server/seed-expanded.json (a raw loki JSON dump) and expect
// `reset:server` to load it cold. That approach silently broke server-
// managed state the engine depends on (loki's idIndex/binaryIndices caches,
// the activeRooms env key) because it skipped every side effect the real
// insert/remove code paths perform. This script instead drives the SAME
// live server the whole project already uses for world changes
// (scripts/expand-map.mjs's map.generateRoom pattern): it connects to the
// admin CLI of a RUNNING `npm run watch:server` instance and calls real
// storage.db collection methods (the same RPC path @screeps/engine itself
// uses every tick) to remove the old room set and insert the new one.
//
// After this finishes, run `npm run reseed:server` (with the server
// STOPPED) to capture the resulting db.json as the new seed-expanded.json,
// so `npm run reset:server` replays this correctly from then on.
//
// Usage (server must already be running via `npm run watch:server`):
//   node scripts/rebuild-world-block-live.mjs <centerRoom> [radius=2] [shard=shard1]
//
// Example:
//   node scripts/rebuild-world-block-live.mjs W47N14 7 shard1
import "dotenv/config";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ScreepsAPI } from "screeps-api";
import screepsConfig from "../screeps.json" with { type: "json" };
import { roomsInRadius } from "./lib/roomGrid.mjs";

const CLI_HOST = "localhost";
const CLI_PORT = 21026;

const cfg = screepsConfig.main;

function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (!resolved) throw new Error(`Missing env var ${match[1]}`);
  return resolved;
}

const [, , centerRoom, radiusArg, shardArg] = process.argv;

if (!centerRoom) {
  console.error("Usage: node scripts/rebuild-world-block-live.mjs <centerRoom> [radius=2] [shard=shard1]");
  console.error("Requires a running server: start `npm run watch:server` first.");
  process.exit(1);
}

const radius = radiusArg ? Number(radiusArg) : 2;
const shard = shardArg || "shard1";
const targetRoomNames = roomsInRadius(centerRoom, radius);
const targetRoomSet = new Set(targetRoomNames);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------
// Admin CLI connection. The CLI only ever prints a reply frame for a
// command when its result/rejection value is truthy (see
// @screeps/backend/lib/cli/sandbox.js: `if (data) outputCallback(...)` on
// the resolved branch) -- falsy resolutions (undefined, 0, removeWhere's
// result) are silently swallowed. So: commands we NEED a reply from
// (queries) use waitForReply; fire-and-forget commands (inserts/removes
// whose success we verify separately via db.json) use fixed pacing only.
// ---------------------------------------------------------------------

function connectCli() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(CLI_PORT, CLI_HOST);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForReply(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for CLI response")); }, timeoutMs);
    const onError = err => { cleanup(); reject(err); };
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

async function cliQuery(socket, command) {
  const replyPromise = waitForReply(socket);
  socket.write(command + "\r\n");
  const raw = await replyPromise;
  return raw.replace(/\r/g, "").replace(/^< /, "").trim();
}

function cliFireAndForget(socket, command) {
  socket.write(command + "\r\n");
}

// ---------------------------------------------------------------------
// World data fetch (unchanged approach from the prior version: sequential,
// retry-after-honoring, rate-limit-safe).
// ---------------------------------------------------------------------

const api = new ScreepsAPI({
  token: resolveEnv(cfg.token),
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

async function withRetry(fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e.message || "";
      if (!/429|Too Many Requests/i.test(msg)) throw e;
      const match = /retry after (\d+)ms/i.exec(msg);
      const waitMs = match ? Number(match[1]) + 500 : 15000;
      console.log(`  rate limited, waiting ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }
  throw new Error("Exceeded retry attempts on rate limiting");
}

const C = {
  SOURCE_ENERGY_NEUTRAL_CAPACITY: 1500,
  SOURCE_ENERGY_KEEPER_CAPACITY: 4000,
  ENERGY_REGEN_TIME: 300,
  MINERAL_DENSITY: { 1: 15000, 2: 35000, 3: 70000, 4: 100000 },
};

const CACHE_DIR = path.join("server", "world-block-cache");
const CACHE_FILE = path.join(CACHE_DIR, `${centerRoom}-r${radius}-${shard}.json`);

async function fetchWorldBlock() {
  if (existsSync(CACHE_FILE)) {
    console.log(`Using cached World fetch at ${CACHE_FILE} (delete it to force a re-fetch).`);
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  }

  console.log(`Fetching ${targetRoomNames.length} room(s) around ${centerRoom} (radius ${radius}, ${shard}) from the World...`);
  const rooms = [];
  let missing = 0;

  for (let i = 0; i < targetRoomNames.length; i++) {
    const roomName = targetRoomNames[i];
    const statusRes = await withRetry(() => api.raw.game.roomStatus(roomName, shard)).catch(e => ({ error: e.message }));
    const terrainRes = await withRetry(() => api.raw.game.roomTerrain(roomName, true, shard)).catch(e => ({ error: e.message }));
    const objectsRes = await withRetry(() => api.raw.game.roomObjects(roomName, shard)).catch(e => ({ error: e.message }));
    await sleep(500);

    const terrain = terrainRes?.terrain?.[0]?.terrain;
    const status = statusRes?.room?.status;

    if (!terrain || !status) {
      missing++;
      console.log(`[${i + 1}/${targetRoomNames.length}] ${roomName}: no data (${statusRes?.error || terrainRes?.error || "room may not exist"})`);
      continue;
    }

    rooms.push({ roomName, status, terrain, objects: objectsRes?.objects || [] });
    if ((i + 1) % 20 === 0 || i === targetRoomNames.length - 1) {
      console.log(`[${i + 1}/${targetRoomNames.length}] fetched=${rooms.length} missing=${missing}`);
    }
  }

  const missRate = missing / targetRoomNames.length;
  if (missRate > 0.1) {
    throw new Error(`${missing}/${targetRoomNames.length} rooms (${(missRate * 100).toFixed(0)}%) failed to fetch -- looks systemic, aborting before touching the server.`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(rooms));
  console.log(`Cached fetch to ${CACHE_FILE}.`);
  return rooms;
}

// ---------------------------------------------------------------------
// Live server mutation.
// ---------------------------------------------------------------------

async function removeExistingRooms(socket) {
  // storage.db.rooms.find() returns a Promise (RPC round trip to the
  // storage process) -- wrap in an async IIFE so the CLI sandbox awaits it
  // before stringifying, rather than trying to JSON.stringify a Promise.
  const listReply = await cliQuery(socket, "(async () => JSON.stringify((await storage.db.rooms.find({})).map(r => r._id)))()");
  // The CLI prints string results via util.inspect (see sandbox.js), which
  // wraps a string value in single quotes -- unwrap that one layer before
  // parsing the JSON payload underneath.
  const unwrapped = listReply.startsWith("'") && listReply.endsWith("'") ? listReply.slice(1, -1) : listReply;
  let existingRoomNames;
  try {
    existingRoomNames = JSON.parse(unwrapped);
  } catch {
    throw new Error(`Could not parse room list from CLI reply: ${listReply.slice(0, 200)}`);
  }

  const toRemove = existingRoomNames.filter(name => !targetRoomSet.has(name));
  console.log(`Removing ${toRemove.length} existing room(s) not in the new World block...`);
  for (let i = 0; i < toRemove.length; i++) {
    cliFireAndForget(socket, `map.removeRoom("${toRemove[i]}")`);
    await sleep(80);
    if ((i + 1) % 50 === 0 || i === toRemove.length - 1) {
      console.log(`[${i + 1}/${toRemove.length}] remove commands sent`);
    }
  }
  // Let the async remove chain (db writes + PNG unlink attempts) settle.
  await sleep(3000);
  return toRemove.length;
}

async function insertWorldBlock(socket, rooms) {
  console.log(`Inserting ${rooms.length} room(s) from the World block into the live server...`);
  let inserted = 0;

  for (let i = 0; i < rooms.length; i++) {
    const { roomName, status, terrain, objects } = rooms[i];
    const hasKeeperLair = objects.some(o => o.type === "keeperLair");
    const normalizedStatus = status === "out of borders" ? "out of borders" : "normal";

    // One command per room: insert the room doc + terrain doc + every
    // object doc via the SAME storage.db methods the engine itself calls
    // on every insert (genId, idIndex maintenance, etc. all happen inside
    // the real code path, not hand-replicated).
    const objectInserts = [];
    for (const obj of objects) {
      if (obj.type === "source") {
        const energy = hasKeeperLair ? C.SOURCE_ENERGY_KEEPER_CAPACITY : C.SOURCE_ENERGY_NEUTRAL_CAPACITY;
        objectInserts.push({
          room: roomName, type: "source", x: obj.x, y: obj.y,
          energy, energyCapacity: energy, ticksToRegeneration: C.ENERGY_REGEN_TIME,
        });
      } else if (obj.type === "mineral") {
        const density = obj.density || 2;
        objectInserts.push({
          type: "mineral", mineralType: obj.mineralType, density,
          mineralAmount: C.MINERAL_DENSITY[density] ?? C.MINERAL_DENSITY[2],
          x: obj.x, y: obj.y, room: roomName,
        });
      } else if (obj.type === "controller") {
        objectInserts.push({ room: roomName, type: "controller", x: obj.x, y: obj.y, level: 0 });
      } else if (obj.type === "keeperLair") {
        objectInserts.push({ room: roomName, type: "keeperLair", x: obj.x, y: obj.y, nextSpawnTime: C.ENERGY_REGEN_TIME });
      } else if (obj.type === "extractor") {
        objectInserts.push({ type: "extractor", x: obj.x, y: obj.y, room: roomName });
      }
    }

    const roomDoc = JSON.stringify({ _id: roomName, status: normalizedStatus, sourceKeepers: hasKeeperLair });
    const terrainDoc = JSON.stringify({ room: roomName, terrain });
    const objectsArrJson = JSON.stringify(objectInserts);

    const command =
      `(async () => { ` +
      `await storage.db.rooms.insert(${roomDoc}); ` +
      `await storage.db["rooms.terrain"].insert(${terrainDoc}); ` +
      `const objs = ${objectsArrJson}; ` +
      `if (objs.length) await storage.db["rooms.objects"].insert(objs); ` +
      `return "OK"; ` +
      `})()`;

    const reply = await cliQuery(socket, command);
    if (!/OK/.test(reply)) {
      console.log(`[${i + 1}/${rooms.length}] ${roomName}: unexpected reply: ${reply.slice(0, 300)}`);
    } else {
      inserted++;
    }
    if ((i + 1) % 20 === 0 || i === rooms.length - 1) {
      console.log(`[${i + 1}/${rooms.length}] inserted=${inserted}`);
    }
  }
  return inserted;
}

async function regenerateMapAssets(socket, roomNames) {
  console.log(`Regenerating map image assets for ${roomNames.length} room(s)...`);
  for (let i = 0; i < roomNames.length; i++) {
    cliFireAndForget(socket, `map.updateRoomImageAssets("${roomNames[i]}")`);
    await sleep(150);
    if ((i + 1) % 20 === 0 || i === roomNames.length - 1) {
      console.log(`[${i + 1}/${roomNames.length}] regen commands sent`);
    }
  }
  await sleep(5000);
}

async function updateTerrainDataCache(socket) {
  console.log("Recomputing the compressed map-view terrain cache (env.terrainData)...");
  await cliQuery(socket, "map.updateTerrainData()").catch(e => console.log("  (non-fatal) updateTerrainData:", e.message));
}

// ---------------------------------------------------------------------

const rooms = await fetchWorldBlock();

console.log(`\nConnecting to admin CLI on ${CLI_HOST}:${CLI_PORT}...`);
const socket = await connectCli().catch(err => {
  console.error(`Could not connect: ${err.message}`);
  console.error("Is the server running (`npm run watch:server`)?");
  process.exit(1);
});
await waitForReply(socket); // discard the connect banner

try {
  const removedCount = await removeExistingRooms(socket);
  const insertedCount = await insertWorldBlock(socket, rooms);
  await regenerateMapAssets(socket, rooms.map(r => r.roomName));
  await updateTerrainDataCache(socket);

  console.log(`\nDone: removed ${removedCount} old room(s), inserted ${insertedCount}/${rooms.length} new room(s).`);
  console.log("\nNext: stop the server (Ctrl-C on watch:server), then run `npm run reseed:server`");
  console.log("to capture this as the new reset seed -- otherwise a future reset:server reverts to");
  console.log("whatever server/seed-expanded.json held before this run.");
} finally {
  socket.end();
}
