// Bakes real-World *static resource* placement (sources, minerals, keeper
// lairs, controller position) into the pserver's reset seed, using data
// extracted by scripts/extract-world-objects.mjs. Companion to
// bake-terrain-seed.mjs -- run that first so the room's terrain exists,
// then this to place its resources.
//
// Deliberately excludes everything else a live World room contains: no
// roads/containers/ramparts/spawns/extensions/towers/storage/links/labs/
// creeps/tombstones, and no ownership/progress on the controller. Every
// resource is reset to a neutral, freshly-generated-room baseline (same
// values node_modules/@screeps/backend/lib/cli/map.js's generateRoom uses):
//   - source: energy = energyCapacity = SOURCE_ENERGY_NEUTRAL_CAPACITY (1500),
//     ticksToRegeneration = ENERGY_REGEN_TIME (300)
//   - mineral: density/mineralType/mineralAmount copied as-is (these are
//     fixed per-room world properties, not live/decaying state)
//   - controller: level 0, no user/progress/safe mode -- unclaimed
//   - keeperLair: no live spawn timer state -- also sets the room's own
//     `rooms.sourceKeepers` flag to true, which is what actually makes the
//     pserver's Source Keeper AI spawn/respawn keepers to guard the lair;
//     the lair object alone is inert without it.
//
// Highway rooms need no baking of their own -- @screeps/backend derives
// "is this a highway" purely from room coordinates (x%10==0 || y%10==0,
// see node_modules/@screeps/backend/lib/utils.js's isBus()), not stored
// data, so any room kept at its real World name/coordinates is automatically
// a highway if the real one was. Live highway content (deposits, power
// banks) is dynamic/decaying state, not static placement, so it's excluded
// same as roads/containers/other structures.
//
// This only edits the seed file on disk -- never talks to a running server.
//
// Usage:
//   node scripts/bake-objects-seed.mjs <extractedObjectsFile> [seedFile=server/seed-expanded.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const SOURCE_ENERGY_NEUTRAL_CAPACITY = 1500;
const ENERGY_REGEN_TIME = 300;

const [, , objectsFileArg, seedFileArg] = process.argv;

if (!objectsFileArg) {
  console.error("Usage: node scripts/bake-objects-seed.mjs <extractedObjectsFile> [seedFile=server/seed-expanded.json]");
  process.exit(1);
}

const seedFile = seedFileArg || path.join("server", "seed-expanded.json");

if (!existsSync(objectsFileArg)) {
  console.error(`No such file: ${objectsFileArg}`);
  process.exit(1);
}
if (!existsSync(seedFile)) {
  console.error(`No seed file at ${seedFile} -- run \`npm run reseed:server\` first (with the server stopped).`);
  process.exit(1);
}

const extracted = JSON.parse(readFileSync(objectsFileArg, "utf8"));
const objectsByRoom = extracted.rooms;
const roomNames = Object.keys(objectsByRoom);

if (roomNames.length === 0) {
  console.error(`${objectsFileArg} has no rooms to bake.`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(seedFile, "utf8"));

function getCollection(name) {
  const collection = seed.collections.find(c => c.name === name);
  if (!collection) throw new Error(`Seed is missing collection "${name}"`);
  return collection;
}

const roomsCollection = getCollection("rooms");
const objectsCollection = getCollection("rooms.objects");

function nextLoki(collection) {
  collection.maxId = (collection.maxId || 0) + 1;
  return collection.maxId;
}

// Deterministic id per (room,type,x,y) so re-running the bake on the same
// extraction is idempotent (updates in place) instead of duplicating.
function stableId(room, type, x, y) {
  return crypto.createHash("md5").update(`${room}:${type}:${x}:${y}`).digest("hex").slice(0, 15);
}

function neutralize(raw, now) {
  const base = { room: raw.room, type: raw.type, x: raw.x, y: raw.y };
  switch (raw.type) {
    case "source":
      return {
        ...base,
        energy: SOURCE_ENERGY_NEUTRAL_CAPACITY,
        energyCapacity: SOURCE_ENERGY_NEUTRAL_CAPACITY,
        ticksToRegeneration: ENERGY_REGEN_TIME,
      };
    case "mineral":
      return {
        ...base,
        mineralType: raw.mineralType,
        density: raw.density,
        mineralAmount: raw.mineralAmount,
      };
    case "keeperLair":
      return base;
    case "controller":
      return { ...base, level: 0 };
    default:
      return null;
  }
}

const now = Date.now();
let updated = 0;
let inserted = 0;
let skippedNoRoom = 0;

let sourceKeeperRooms = 0;

for (const room of roomNames) {
  const roomDoc = roomsCollection.data.find(d => d._id === room);
  if (!roomDoc) {
    console.log(`Skipping ${room}: room not present in seed -- run bake-terrain-seed.mjs for it first.`);
    skippedNoRoom++;
    continue;
  }

  const hasKeeperLair = objectsByRoom[room].some(o => o.type === "keeperLair");
  if (hasKeeperLair && !roomDoc.sourceKeepers) {
    roomDoc.sourceKeepers = true;
    sourceKeeperRooms++;
  }

  for (const raw of objectsByRoom[room]) {
    const clean = neutralize(raw, now);
    if (!clean) continue; // not a static-resource type, ignore

    const id = stableId(clean.room, clean.type, clean.x, clean.y);
    const existing = objectsCollection.data.find(d => d._id === id);

    if (existing) {
      Object.assign(existing, clean);
      if (existing.meta) existing.meta.updated = now;
      updated++;
    } else {
      objectsCollection.data.push({
        ...clean,
        _id: id,
        meta: { revision: 0, created: now, version: 0, updated: now },
        $loki: nextLoki(objectsCollection),
      });
      inserted++;
    }
  }
}

writeFileSync(seedFile, JSON.stringify(seed));

console.log(`Baked resources for ${roomNames.length - skippedNoRoom} room(s) into ${seedFile}: ${updated} updated in place, ${inserted} newly inserted.`);
if (sourceKeeperRooms > 0) console.log(`Marked ${sourceKeeperRooms} room(s) as sourceKeepers:true (had a keeperLair).`);
if (skippedNoRoom > 0) console.log(`Skipped ${skippedNoRoom} room(s) with no terrain baked yet.`);
console.log("\n`npm run reset:server` will now restore these resources.");
