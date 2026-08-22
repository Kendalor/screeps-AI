// Rebuilds the pserver's reset seed (server/seed-expanded.json) from
// scratch as an EXACT, grid-aligned copy of a block of rooms from the real
// Screeps World server (screeps.com): same room names, same terrain, same
// sources/minerals/controllers/keeper lairs, same highway/center layout —
// because the pserver and the World use the identical room-name <-> (x,y)
// convention (see scripts/lib/roomGrid.mjs), copying by name IS copying by
// grid position.
//
// Unlike the old extract-world-terrain.mjs + bake-terrain-seed.mjs pair,
// this does NOT overlay onto whatever rooms the pserver already has. It
// starts from the launcher's clean stock seed (121 default rooms) and
// throws that starter grid away entirely, replacing rooms/rooms.objects/
// rooms.terrain with ONLY the extracted block. Nothing of a prior pserver
// map survives -- highways, sector centers, and SK rooms all come from the
// real World's own classification, not the pserver's generator.
//
// This only reads from the World server and writes server/seed-expanded.json
// on disk -- it never touches a running pserver. Run `npm run reset:server`
// afterward to load it into server/db.json.
//
// Usage:
//   node scripts/bake-world-block.mjs <centerRoom> [radius=2] [shard=shard1] [seedFile=server/seed-expanded.json]
//
// Example:
//   node scripts/bake-world-block.mjs W47N14 7 shard1
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { ScreepsAPI } from "screeps-api";
import screepsConfig from "../screeps.json" with { type: "json" };
import { roomsInRadius } from "./lib/roomGrid.mjs";

const cfg = screepsConfig.main;

function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (!resolved) throw new Error(`Missing env var ${match[1]}`);
  return resolved;
}

const [, , centerRoom, radiusArg, shardArg, seedFileArg] = process.argv;

if (!centerRoom) {
  console.error("Usage: node scripts/bake-world-block.mjs <centerRoom> [radius=2] [shard=shard1] [seedFile=server/seed-expanded.json]");
  process.exit(1);
}

const radius = radiusArg ? Number(radiusArg) : 2;
const shard = shardArg || "shard1";
const seedFile = seedFileArg || path.join("server", "seed-expanded.json");

const STOCK_SEED_FILE = path.join(
  process.cwd(),
  "node_modules",
  "@screeps",
  "launcher",
  "init_dist",
  "db.json"
);

if (!existsSync(STOCK_SEED_FILE)) {
  console.error(`Cannot find stock seed at ${STOCK_SEED_FILE} -- is @screeps/launcher installed?`);
  process.exit(1);
}

const roomNames = roomsInRadius(centerRoom, radius);

const api = new ScreepsAPI({
  token: resolveEnv(cfg.token),
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

// Mirrors @screeps/storage/lib/db.js's genId() exactly, so hand-built docs
// look indistinguishable from ones the engine inserted itself.
function genId() {
  const hex4 = () => {
    let v = Math.floor(Math.random() * 0x10000).toString(16);
    while (v.length < 4) v = "0" + v;
    return v;
  };
  return hex4() + Date.now().toString(16).slice(4) + hex4();
}

const C = {
  SOURCE_ENERGY_NEUTRAL_CAPACITY: 1500,
  SOURCE_ENERGY_KEEPER_CAPACITY: 4000,
  ENERGY_REGEN_TIME: 300,
  MINERAL_DENSITY: { 1: 15000, 2: 35000, 3: 70000, 4: 100000 },
};

console.log(`Fetching ${roomNames.length} room(s) around ${centerRoom} (radius ${radius}, ${shard})...`);
console.log("Waiting 20s before the first request, in case a prior run left the rate limiter hot...");
await new Promise(r => setTimeout(r, 20000));

const now = Date.now();
const roomDocs = [];
const terrainDocs = [];
const objectDocs = [];

let ok = 0;
let missing = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry a single flaky/rate-limited call, instead of counting a transient
// 429 as "room has no data" (which would punch permanent holes in an
// otherwise fine block). The API's 429 body tells us exactly how long to
// wait ("retry after Nms") -- honor that instead of guessing with a fixed
// backoff ladder, since a tripped limiter's cooldown can run well past 30s.
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

for (let i = 0; i < roomNames.length; i++) {
  const roomName = roomNames[i];

  // Sequential, not parallel, with a steady gap between rooms: staying well
  // under the limiter's threshold throughout is more reliable than reacting
  // to 429s after tripping it.
  const statusRes = await withRetry(() => api.raw.game.roomStatus(roomName, shard)).catch(e => ({ error: e.message }));
  const terrainRes = await withRetry(() => api.raw.game.roomTerrain(roomName, true, shard)).catch(e => ({ error: e.message }));
  const objectsRes = await withRetry(() => api.raw.game.roomObjects(roomName, shard)).catch(e => ({ error: e.message }));
  await sleep(500);

  const terrain = terrainRes?.terrain?.[0]?.terrain;
  const status = statusRes?.room?.status;

  if (!terrain || !status) {
    missing++;
    console.log(`[${i + 1}/${roomNames.length}] ${roomName}: no data (${statusRes?.error || terrainRes?.error || "room may not exist"})`);
    continue;
  }

  const worldObjects = objectsRes?.objects || [];
  const hasKeeperLair = worldObjects.some(o => o.type === "keeperLair");

  roomDocs.push({
    _id: roomName,
    status: status === "out of borders" ? "out of borders" : "normal",
    sourceKeepers: hasKeeperLair,
    meta: { revision: 0, created: now, version: 0, updated: now },
    $loki: 0, // reassigned below
  });

  terrainDocs.push({
    room: roomName,
    terrain,
    meta: { revision: 0, created: now, version: 0, updated: now },
    $loki: 0, // reassigned below
  });

  for (const obj of worldObjects) {
    if (obj.type === "source") {
      objectDocs.push({
        room: roomName,
        type: "source",
        x: obj.x,
        y: obj.y,
        energy: hasKeeperLair ? C.SOURCE_ENERGY_KEEPER_CAPACITY : C.SOURCE_ENERGY_NEUTRAL_CAPACITY,
        energyCapacity: hasKeeperLair ? C.SOURCE_ENERGY_KEEPER_CAPACITY : C.SOURCE_ENERGY_NEUTRAL_CAPACITY,
        ticksToRegeneration: C.ENERGY_REGEN_TIME,
        _id: genId(),
        meta: { revision: 0, created: now, version: 0, updated: now },
        $loki: 0,
      });
    } else if (obj.type === "mineral") {
      const density = obj.density || 2;
      objectDocs.push({
        type: "mineral",
        mineralType: obj.mineralType,
        density,
        mineralAmount: C.MINERAL_DENSITY[density] ?? C.MINERAL_DENSITY[2],
        x: obj.x,
        y: obj.y,
        room: roomName,
        _id: genId(),
        meta: { revision: 0, created: now, version: 0, updated: now },
        $loki: 0,
      });
    } else if (obj.type === "controller") {
      objectDocs.push({
        room: roomName,
        type: "controller",
        x: obj.x,
        y: obj.y,
        level: 0,
        _id: genId(),
        meta: { revision: 0, created: now, version: 0, updated: now },
        $loki: 0,
      });
    } else if (obj.type === "keeperLair") {
      objectDocs.push({
        room: roomName,
        type: "keeperLair",
        x: obj.x,
        y: obj.y,
        nextSpawnTime: C.ENERGY_REGEN_TIME,
        _id: genId(),
        meta: { revision: 0, created: now, version: 0, updated: now },
        $loki: 0,
      });
    } else if (obj.type === "extractor") {
      objectDocs.push({
        type: "extractor",
        x: obj.x,
        y: obj.y,
        room: roomName,
        _id: genId(),
        meta: { revision: 0, created: now, version: 0 },
        $loki: 0,
      });
    }
    // Deliberately skipped: controller/creep ownership, ruins, structures
    // belonging to real players, invader cores, power banks/deposits --
    // this is a neutral world snapshot, not a live mirror.
  }

  ok++;
  if ((i + 1) % 10 === 0 || i === roomNames.length - 1) {
    console.log(`[${i + 1}/${roomNames.length}] ok=${ok} missing=${missing}`);
  }
}

if (ok === 0) {
  console.error("No rooms fetched successfully -- aborting, seed left untouched.");
  process.exit(1);
}

// A handful of legitimately absent/out-of-borders edge rooms is normal; a
// large miss rate means something systemic (rate limiting, auth, network)
// silently punched holes in the block. Refuse to write a holey seed.
const missRate = missing / roomNames.length;
if (missRate > 0.1) {
  console.error(`\n${missing}/${roomNames.length} rooms (${(missRate * 100).toFixed(0)}%) failed -- looks systemic, not just sparse map edges.`);
  console.error("Aborting without writing the seed. Re-run once the underlying issue (rate limit, auth, network) is resolved.");
  process.exit(1);
}

// Build the new seed from the clean launcher stock (system users, empty
// market/transactions/etc.) and drop its default 121-room starter grid.
const seed = JSON.parse(readFileSync(STOCK_SEED_FILE, "utf8"));

function getCollection(name) {
  const collection = seed.collections.find(c => c.name === name);
  if (!collection) throw new Error(`Stock seed is missing collection "${name}"`);
  return collection;
}

const roomsCollection = getCollection("rooms");
const terrainCollection = getCollection("rooms.terrain");
const objectsCollection = getCollection("rooms.objects");
const envCollection = getCollection("env");

roomsCollection.data = [];
terrainCollection.data = [];
objectsCollection.data = [];
roomsCollection.maxId = 0;
terrainCollection.maxId = 0;
objectsCollection.maxId = 0;

for (const doc of roomDocs) {
  doc.$loki = ++roomsCollection.maxId;
  roomsCollection.data.push(doc);
}
for (const doc of terrainDocs) {
  doc.$loki = ++terrainCollection.maxId;
  terrainCollection.data.push(doc);
}
for (const doc of objectDocs) {
  doc.$loki = ++objectsCollection.maxId;
  objectsCollection.data.push(doc);
}

// loki persists its own internal indices/caches (idIndex maps $loki id ->
// data array position for binary search) alongside `data`. We just replaced
// `data` wholesale by hand, outside loki's API, so those caches are now
// stale relative to the new array -- collection.by('_id', ...) and similar
// index-based lookups silently break ("fun is not a function", deep in
// lokijs's operator dispatch) if left pointing at the old 121-room stock
// layout. Rebuild each touched collection's index/cache fields to match.
for (const collection of [roomsCollection, terrainCollection, objectsCollection]) {
  collection.idIndex = collection.data.map(d => d.$loki);
  collection.binaryIndices = {};
  collection.cachedIndex = null;
  collection.cachedBinaryIndex = null;
  collection.cachedData = null;
  collection.dirty = true;
}

// Recompute env.terrainData exactly like @screeps/backend's
// map.js updateTerrainData(): a zlib-deflated, base64-encoded JSON array of
// {room, terrain} for every room in the db, plus synthesized all-wall
// entries for each room's unlisted N/E neighbor (the client map view reads
// one row/col past the edge of explored space).
const WALLED = "1".repeat(2500);
const terrainByRoom = new Map(terrainDocs.map(d => [d.room, d]));

for (const room of roomDocs) {
  const m = room._id.match(/(W|E)(\d+)(N|S)(\d+)/);
  if (!m) continue;
  const roomH = `${m[1]}${Number(m[2]) + 1}${m[3]}${m[4]}`;
  const roomV = `${m[1]}${m[2]}${m[3]}${Number(m[4]) + 1}`;
  if (!terrainByRoom.has(roomH)) terrainByRoom.set(roomH, { room: roomH, terrain: WALLED });
  if (!terrainByRoom.has(roomV)) terrainByRoom.set(roomV, { room: roomV, terrain: WALLED });
}

const terrainDataArray = [...terrainByRoom.values()].map(d => ({ room: d.room, terrain: d.terrain }));
const compressed = zlib.deflateSync(JSON.stringify(terrainDataArray));

const cleanEnvData = {
  gameTime: 1,
  accessibleRooms: JSON.stringify(roomDocs.map(r => r._id)),
  terrainData: compressed.toString("base64"),
  // @screeps/backend's roomsForceUpdate/genInvaders cronjobs do
  // `db.rooms.find({_id: {$nin: activeRooms}})` on every tick. If this key
  // is absent, dbEnvSmembers callbacks with no data, getActiveRooms()
  // resolves to undefined, and lokijs throws trying to read `.indexOf` off
  // an undefined $nin value -- a chicken-and-egg crash loop, since the only
  // code path that would ever populate this key is inside the same cronjob
  // that crashes before reaching it. Seed it pre-populated so the first
  // tick has something to compare against.
  activeRooms: [],
};
envCollection.data[0].data = cleanEnvData;
if (envCollection.data[0].meta) envCollection.data[0].meta.updated = now;

writeFileSync(seedFile, JSON.stringify(seed));

console.log(`\nWrote ${seedFile}:`);
console.log(`  ${roomDocs.length} room(s), ${terrainDocs.length} terrain doc(s), ${objectDocs.length} object(s)`);
console.log(`  (missing/skipped: ${missing})`);
console.log("\n`npm run reset:server` will now load this as a clean, grid-aligned copy of the World block.");
console.log("After starting `npm run watch:server`, also run `npm run regen-map-assets` -- the");
console.log("map-view PNGs under server/assets/map/ are separate static files reset:server doesn't");
console.log("touch, so without this the client's map view will show stale/missing room tiles even");
console.log("though the underlying terrain data (what you see inside a room) is already correct.");
