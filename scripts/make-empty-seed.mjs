// Produces a seed with every room stripped out but user accounts (and their
// Memory) kept intact, so a full-World-replica map can be baked in from a
// clean slate without losing registered accounts / needing to re-register
// in the Steam client.
//
// Clears:
//   - rooms, rooms.terrain, rooms.objects, rooms.flags, rooms.intents,
//     market.stats (all room-scoped collections)
//   - each user's `.rooms` array (would otherwise point at deleted rooms)
//   - env's room-scoped keys: accessibleRooms, activeRooms, roomStatusData
//     (reset to the empty {novice:{},respawn:{},closed:{}} shape), every
//     `mapView:<room>` and `roomHistory:<room>` key
//
// Keeps: users (accounts, GCL, badges), each user's `memory:<userId>` env
// key (their Memory blob), transactions, market.orders/intents, users.code,
// users.console, users.power_creeps, users.notifications, users.money.
//
// This only reads/writes seed files on disk -- never talks to a running
// server.
//
// Usage:
//   node scripts/make-empty-seed.mjs [sourceSeed=server/seed-expanded.json] [outFile=server/seed-empty.json]
//
// After this, bake terrain/objects into outFile (pointing bake-*-seed.mjs's
// seedFile argument at it) to build up a full replica from scratch, then
// copy it over server/seed-expanded.json (or point reset-server.mjs at it)
// to make `npm run reset:server` restore it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const [, , sourceArg, outFileArg] = process.argv;

const sourceFile = sourceArg || path.join("server", "seed-expanded.json");
const outFile = outFileArg || path.join("server", "seed-empty.json");

if (!existsSync(sourceFile)) {
  console.error(`No seed file at ${sourceFile}`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(sourceFile, "utf8"));

const ROOM_SCOPED_COLLECTIONS = ["rooms", "rooms.terrain", "rooms.objects", "rooms.flags", "rooms.intents", "market.stats"];

for (const name of ROOM_SCOPED_COLLECTIONS) {
  const collection = seed.collections.find(c => c.name === name);
  if (!collection) continue;
  collection.data = [];
  collection.maxId = 0;
}

const usersCollection = seed.collections.find(c => c.name === "users");
if (usersCollection) {
  for (const user of usersCollection.data) {
    if (user.rooms) user.rooms = [];
  }
}

const envCollection = seed.collections.find(c => c.name === "env");
if (envCollection) {
  const envData = envCollection.data[0].data;
  envData.accessibleRooms = "[]";
  envData.activeRooms = [];
  envData.roomStatusData = JSON.stringify({ novice: {}, respawn: {}, closed: {} });
  for (const key of Object.keys(envData)) {
    if (key.startsWith("mapView:") || key.startsWith("roomHistory:")) {
      delete envData[key];
    }
  }
}

writeFileSync(outFile, JSON.stringify(seed));

console.log(`Wrote empty-world seed to ${outFile} (rooms stripped, accounts/Memory kept).`);
console.log("\nNext: bake terrain + objects into it, e.g.");
console.log(`  node scripts/bake-terrain-seed.mjs <terrainFile> ${outFile}`);
console.log(`  node scripts/bake-objects-seed.mjs <objectsFile> ${outFile}`);
console.log(`\nThen make it the reset target, e.g. copy it over server/seed-expanded.json.`);
