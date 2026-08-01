// Throwaway diagnostic: RCL5 seed produced ZERO spawns in 500 ticks (worse than RCL3!). Check what
// seedColony actually produced (structure counts, creep counts) right after seeding. Delete before
// committing.
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, scoutableTerrain } from "./harness";
import { seedColony } from "./seed";

const HOME = "W0N1";
let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: scoutableTerrain(), gcl: 1_000_000 });
  await colony.runTicks(5);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "diagnostic",
  async () => {
    const seeded = await seedColony(colony, { level: 5 });
    // eslint-disable-next-line no-console
    console.log("SEEDED STRUCTURES COUNT:", seeded.structures.length);
    // eslint-disable-next-line no-console
    console.log("SEEDED CREEPS COUNT:", seeded.creeps.length);
    // eslint-disable-next-line no-console
    console.log("SEEDED ENERGY:", seeded.energy);
    const spawns = await colony.structures("spawn");
    const extensions = await colony.structures("extension");
    const storage = await colony.structures("storage");
    // eslint-disable-next-line no-console
    console.log("SPAWNS:", spawns.length, "EXTENSIONS:", extensions.length, "STORAGE:", storage.length);
    const creepsNow = await colony.creepCount();
    // eslint-disable-next-line no-console
    console.log("CREEPS RIGHT AFTER SEED:", creepsNow);
    expect(true).toBe(true);
  },
  60_000
);
