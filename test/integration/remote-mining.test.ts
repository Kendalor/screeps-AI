// Remote mining, end to end, from a stable base: a finished RCL3 colony with a neighbouring room
// already scouted should, under its own behavior, select the remote (pickRemotes), reserve its
// controller (Reservation's claimer), staff a miner on its source, and haul the energy home
// (Logistics' cross-room return-haul) — with no test-side shortcut for any of those steps.
//
// Why seeded, not cold: the point here is to observe the remote-mining pipeline, not re-measure the
// RCL climb (see rcl3.test.ts) or scouting itself (see scouting.test.ts). The neighbour's scout
// record is seeded directly into Memory.rooms[...].scouted — the exact shape recordScout would have
// written — so the test exercises selection/reservation/mining/haul deterministically rather than
// waiting on a scout to physically walk the room first.
//
// Terrain: scoutableTerrain() (shared with scouting.test.ts) opens W0N1's borders exactly where the
// stub neighbours W0N2 and W1N1 have their facing exits, so a claimer/miner can actually cross. W1N1
// is the target here, not W0N2: stubWorld()'s 9-room block sits on the x∈{0,1,2}/y∈{0,1,2} grid, so
// every room with x=0 or y=0 (including W0N2) is a highway room by roomType()'s own real classification
// — pickRemotes correctly refuses to mine a highway (no sources worth the trip, in production). W1N1 is
// the only stub neighbour that is genuinely "normal", matching what a real remote-mining candidate looks
// like.
//
// RCL3, not RCL2: pickRemotes gates on energyCapacity >= 550 (MIN_ENERGY_CAPACITY); RCL2's five
// extensions cap at 550 exactly but RCL3's ten extensions (800) clears it with margin once seeded.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder, scoutableTerrain } from "./harness";
import { seedColony } from "./seed";

const HOME = "W0N1";
const REMOTE = "W1N1";

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

  // Seed the remote's scout record directly — the same shape recordScout writes — so remote
  // selection can run immediately instead of waiting on a scout to physically survey it first.
  const remoteObjects = (await colony.server.world.roomObjects(REMOTE)) as Array<{
    type: string;
    x: number;
    y: number;
    _id: string;
  }>;
  const remoteSources = remoteObjects
    .filter(o => o.type === "source")
    .map(s => ({ id: s._id, x: s.x, y: s.y }));
  expect(remoteSources.length, `${REMOTE} has no sources to seed`).toBeGreaterThan(0);

  await colony.patchMemory(mem => {
    const rooms = (mem.rooms ??= {}) as Record<string, { scouted?: unknown }>;
    rooms[REMOTE] = {
      scouted: {
        tick: 1,
        type: "normal",
        sources: remoteSources,
        hostile: false
      }
    };
  });
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a stable colony autonomously mines and reserves an already-scouted neighbour",
  async () => {
    const ladder = new CheckpointLadder([
      // Confirms the seed took (workforce alive from tick one), not a cold recovery.
      { name: "workforce alive", by: 20 },
      // Mining's throttled remoteSelection intent (every 100 ticks) picked up the seeded scout data.
      { name: "remote selected", by: 300 },
      // Reservation's claimer walked to the remote and reserved its controller.
      { name: "remote reserved", by: 1500 },
      // Mining staffed a miner on one of the remote's sources.
      { name: "remote miner staffed", by: 1500 },
      // Energy actually made it back to the home room's storage/containers via the return-haul.
      { name: "energy hauled home", by: 3000 }
    ]);

    const remoteMemory = async (): Promise<{ room: string; reserved: boolean } | undefined> => {
      const mem = (await colony.memory()) as {
        colonies?: Record<string, { remotes?: Array<{ room: string; reserved: boolean }> }>;
      };
      return mem.colonies?.[HOME]?.remotes?.find(r => r.room === REMOTE);
    };

    const remoteReserved = async (): Promise<boolean> => {
      const objs = (await colony.server.world.roomObjects(REMOTE)) as Array<{
        type: string;
        reservation?: { username?: string };
      }>;
      const controller = objs.find(o => o.type === "controller");
      return controller?.reservation?.username === colony.bot.username;
    };

    const minerInRemote = async (): Promise<boolean> => {
      const objs = (await colony.server.world.roomObjects(REMOTE)) as Array<{ type: string; user?: string }>;
      return objs.some(o => o.type === "creep" && o.user === colony.bot.id);
    };

    const homeEnergy = async (): Promise<number> =>
      (await colony.energyIn("container")) + (await colony.energyIn("storage"));

    const baselineHomeEnergy = await homeEnergy();
    let haulReachedTick: number | undefined;

    const reached = await colony.runUntil(
      async () => (await homeEnergy()) > baselineHomeEnergy + 200, // meaningful inflow, not a single stray hauler trip
      3000,
      async tick => {
        const creeps = await colony.creepCount();
        const selected = await remoteMemory();
        const reserved = await remoteReserved();
        const minerPresent = await minerInRemote();
        if (haulReachedTick === undefined && (await homeEnergy()) > baselineHomeEnergy + 200) {
          haulReachedTick = tick;
        }
        await ladder.sample(tick, name => {
          switch (name) {
            case "workforce alive":
              return creeps > 0;
            case "remote selected":
              return selected !== undefined;
            case "remote reserved":
              return reserved;
            case "remote miner staffed":
              return minerPresent;
            case "energy hauled home":
              return haulReachedTick !== undefined;
            default:
              return false;
          }
        });
      }
    );

    expect(reached, `remote mining never produced a meaningful home energy inflow within 3000 ticks:\n${ladder.report()}`).not.toBeNull();
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    const selected = await remoteMemory();
    expect(selected, `${REMOTE} was never selected as a remote — check pickRemotes' economics gates`).toBeDefined();

    expect(await remoteReserved(), `${REMOTE}'s controller was never reserved by the colony`).toBe(true);
    expect(await minerInRemote(), `no miner ever entered ${REMOTE}`).toBe(true);
  },
  300_000
);
