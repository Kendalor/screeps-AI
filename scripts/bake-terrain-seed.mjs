// Bakes real-World terrain (extracted via scripts/extract-world-terrain.mjs)
// into the pserver's reset seed (server/seed-expanded.json), so `npm run
// reset:server` restores real terrain without any live-server CLI mutation.
//
// This only edits the seed file on disk — it never talks to a running
// server. Per docs/... (see scripts/reseed-server.mjs's own warning), don't
// run this while `npm run watch:server` is writing server/db.json
// concurrently; it's fine against seed-expanded.json itself since that file
// is only ever written by reseed-server.mjs between server runs.
//
// What it does per room in the extracted JSON:
//   - If the room already exists in the seed's `rooms` collection, overwrites
//     just its `rooms.terrain` doc's `terrain` string in place (keeps the
//     room's existing objects/status/$loki untouched).
//   - If the room is new, inserts fresh `rooms` + `rooms.terrain` docs with
//     freshly allocated $loki ids (bumping each collection's maxId). No
//     rooms.objects are added -- this is terrain-only by design; sources/
//     minerals/controllers for a brand new room are left absent, same as any
//     room with no objects yet.
// Then recomputes `env.data.terrainData` exactly like
// node_modules/@screeps/backend/lib/cli/map.js's updateTerrainData(): a
// zlib-deflated, base64-encoded JSON array of {room, terrain} for every room
// in the db (with synthesized all-wall terrain for out-of-borders rooms and
// for the phantom "next row/col" neighbor rooms the client map view expects).
//
// Usage:
//   node scripts/bake-terrain-seed.mjs <extractedTerrainFile> [seedFile=server/seed-expanded.json]
//
// After baking, `npm run reset:server` will restore this seed with the new
// terrain. If you haven't captured a seed yet, run `npm run reseed:server`
// first (with the server stopped) to create server/seed-expanded.json from
// the current server/db.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const [, , terrainFileArg, seedFileArg] = process.argv;

if (!terrainFileArg) {
  console.error("Usage: node scripts/bake-terrain-seed.mjs <extractedTerrainFile> [seedFile=server/seed-expanded.json]");
  process.exit(1);
}

const seedFile = seedFileArg || path.join("server", "seed-expanded.json");

if (!existsSync(terrainFileArg)) {
  console.error(`No such file: ${terrainFileArg}`);
  process.exit(1);
}
if (!existsSync(seedFile)) {
  console.error(`No seed file at ${seedFile} -- run \`npm run reseed:server\` first (with the server stopped).`);
  process.exit(1);
}

const extracted = JSON.parse(readFileSync(terrainFileArg, "utf8"));
const roomTerrainByName = extracted.rooms;
const roomNames = Object.keys(roomTerrainByName);

if (roomNames.length === 0) {
  console.error(`${terrainFileArg} has no rooms to bake.`);
  process.exit(1);
}

const terrainPattern = /^[0123]{2500}$/;
for (const room of roomNames) {
  if (!terrainPattern.test(roomTerrainByName[room])) {
    console.error(`Room ${room}: terrain string is not a valid 2500-char 0/1/2/3 encoding -- aborting, seed left untouched.`);
    process.exit(1);
  }
}

const seed = JSON.parse(readFileSync(seedFile, "utf8"));

function getCollection(name) {
  const collection = seed.collections.find(c => c.name === name);
  if (!collection) throw new Error(`Seed is missing collection "${name}"`);
  return collection;
}

const roomsCollection = getCollection("rooms");
const terrainCollection = getCollection("rooms.terrain");
const envCollection = getCollection("env");

function nextLoki(collection) {
  collection.maxId = (collection.maxId || 0) + 1;
  return collection.maxId;
}

const now = Date.now();
let updated = 0;
let inserted = 0;

for (const room of roomNames) {
  const terrain = roomTerrainByName[room];
  const existingTerrainDoc = terrainCollection.data.find(d => d.room === room);
  const existingRoomDoc = roomsCollection.data.find(d => d._id === room);

  if (existingTerrainDoc) {
    existingTerrainDoc.terrain = terrain;
    if (existingTerrainDoc.meta) existingTerrainDoc.meta.updated = now;
    updated++;
  } else {
    terrainCollection.data.push({
      room,
      terrain,
      meta: { revision: 0, created: now, version: 0, updated: now },
      $loki: nextLoki(terrainCollection),
    });
    inserted++;
  }

  if (!existingRoomDoc) {
    roomsCollection.data.push({
      _id: room,
      status: "normal",
      sourceKeepers: false,
      meta: { revision: 0, created: now, version: 0, updated: now },
      $loki: nextLoki(roomsCollection),
    });
  }
}

// Mirror @screeps/backend's map.updateTerrainData(): every room gets an
// entry in the cached terrainData blob, out-of-borders rooms are reported
// as solid walls, and every room's unlisted N/E neighbor (roomH/roomV) gets
// a synthesized all-wall entry if it doesn't already have real terrain --
// the client map view reads one row/col past the edge of explored space.
const WALLED = "1".repeat(2500);

const allRooms = roomsCollection.data;
const terrainByRoom = new Map(terrainCollection.data.map(d => [d.room, d]));

for (const room of allRooms) {
  if (room.status === "out of borders") {
    const doc = terrainByRoom.get(room._id);
    if (doc) doc.terrain = WALLED;
  }
  const m = room._id.match(/(W|E)(\d+)(N|S)(\d+)/);
  if (!m) continue;
  const roomH = `${m[1]}${Number(m[2]) + 1}${m[3]}${m[4]}`;
  const roomV = `${m[1]}${m[2]}${m[3]}${Number(m[4]) + 1}`;
  if (!terrainByRoom.has(roomH)) {
    terrainByRoom.set(roomH, { room: roomH, terrain: WALLED });
  }
  if (!terrainByRoom.has(roomV)) {
    terrainByRoom.set(roomV, { room: roomV, terrain: WALLED });
  }
}

const terrainDataArray = [...terrainByRoom.values()].map(d => ({ room: d.room, terrain: d.terrain }));
const compressed = zlib.deflateSync(JSON.stringify(terrainDataArray));
envCollection.data[0].data.terrainData = compressed.toString("base64");
if (envCollection.data[0].meta) envCollection.data[0].meta.updated = now;

writeFileSync(seedFile, JSON.stringify(seed));

console.log(`Baked ${roomNames.length} room(s) into ${seedFile}: ${updated} updated in place, ${inserted} newly inserted.`);
console.log("Recomputed env.terrainData cache to match.");
console.log("\n`npm run reset:server` will now restore this terrain.");
