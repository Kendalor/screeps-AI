// Scouting, end to end, from a stable base — the opposite of a cold start. A finished RCL3 colony is
// seeded (structures, workforce, 70% energy) and given a scout, then left to run: the scout walks
// into the neighbouring rooms and records what it sees, and the test watches those foreign rooms
// appear in Memory.rooms[].scouted with real observations.
//
// Why seeded, not cold: on a cold boot the colony spends thousands of ticks on the RCL climb before
// it can spare a spawn for a priority-30 scout, and the point here is to observe scouting, not
// re-measure the economy. The scout is seeded directly for the same reason — so the test exercises
// the scouting *behaviour* (travel, record, retarget, radius growth) deterministically rather than
// waiting on the spawn arbiter to eventually field one on a busy colony.
//
// Terrain: the default bunkerTerrain() walls the whole perimeter, which would trap a scout.
// scoutableTerrain() opens the home room's borders exactly where stubWorld's neighbours have their
// facing exits (north into W0N2, west into W1N1) — a room transition needs both sides walkable at the
// same coordinates — while leaving the interior (and thus the bunker anchor) intact. Those two rooms
// are SCOUTABLE_NEIGHBOURS; the south neighbour W0N0 has no facing exit and is deliberately excluded.

import { afterAll, beforeAll, expect, test } from "vitest";
import { roomType } from "../../src/lib/roomName";
import { BootedColony, bundleBot, CheckpointLadder, scoutableTerrain, SCOUTABLE_NEIGHBOURS } from "./harness";
import { seedColony } from "./seed";

const HOME = "W0N1";

// The anchor (Memory.colonies[room].anchor) is not cached until the bot has run a tick; seedColony
// throws without it.
const TICKS_TO_ANCHOR = 5;

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: scoutableTerrain() });

  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(await colony.anchor(), "the bot never cached a bunker anchor — nothing downstream runs").not.toBeNull();

  // A finished RCL3 base: structures, workforce and energy all from the bot's own planners.
  const seeded = await seedColony(colony, { level: 3 });
  expect(seeded.creeps.length, "no workforce was seeded — the colony would cold-start instead").toBeGreaterThan(0);
  expect(seeded.energy, "the seeded colony started with no energy — it would recover rather than run").toBeGreaterThan(0);

  // Seed a scout so the behaviour is observed deterministically. It carries the Scouting operation's
  // own op stamp, so the operation claims and drives it exactly as it would a spawned one.
  const spawn = (await colony.structures("spawn"))[0];
  const gameTime = await colony.server.world.gameTime;
  await colony.addCreep("scout_seed", spawn.x + 1, spawn.y + 1, {
    body: [{ type: "move", hits: 100 }],
    store: { energy: 0 },
    storeCapacity: 0,
    hits: 100,
    hitsMax: 100,
    spawning: false,
    fatigue: 0,
    ageTime: gameTime + 1400
  });
  await colony.patchMemory(mem => {
    const creeps = (mem.creeps ??= {}) as Record<string, CreepMemory>;
    creeps.scout_seed = { role: "scout", home: HOME, op: `scouting:${HOME}` };
  });
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a stable colony's scout surveys the reachable neighbouring rooms",
  async () => {
    const ladder = new CheckpointLadder([
      // Confirms the seed took (workforce alive from tick one), not a cold recovery.
      { name: "workforce alive", by: 20 },
      // The scout has left home and recorded its first neighbour.
      { name: "first neighbour scouted", by: 500 },
      // Both reachable neighbours surveyed.
      { name: "all reachable neighbours scouted", by: 1500 }
    ]);

    const allScouted = async (): Promise<boolean> => {
      const scouted = await colony.scoutedRooms();
      return SCOUTABLE_NEIGHBOURS.every(r => scouted[r] !== undefined);
    };

    const reached = await colony.runUntil(allScouted, 1500, async tick => {
      const creeps = await colony.creepCount();
      const scouted = await colony.scoutedRooms();
      const any = SCOUTABLE_NEIGHBOURS.some(r => scouted[r] !== undefined);
      await ladder.sample(tick, name => {
        switch (name) {
          case "workforce alive":
            return creeps > 0;
          case "first neighbour scouted":
            return any;
          case "all reachable neighbours scouted":
            return SCOUTABLE_NEIGHBOURS.every(r => scouted[r] !== undefined);
          default:
            return false;
        }
      });
    });

    expect(reached, `not every reachable neighbour was scouted within 1500 ticks:\n${ladder.report()}`).not.toBeNull();
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    // The observations are real, not empty stamps: each neighbour recorded the sources it actually
    // holds (all have at least one), was classified from its own name, and carries an observation tick.
    const scouted = await colony.scoutedRooms();
    for (const room of SCOUTABLE_NEIGHBOURS) {
      const info = scouted[room];
      expect(info, `${room} was never recorded`).toBeDefined();
      expect(info.sources, `${room} recorded no sources`).toBeGreaterThan(0);
      expect(info.type, `${room} misclassified`).toBe(roomType(room));
      expect(info.tick, `${room} has no observation tick`).toBeGreaterThan(0);
    }
  },
  300_000
);
