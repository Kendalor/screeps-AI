// gh issue #22: the colony builds its own source container.
//
// This is the scenario the issue describes as flatlining. Base_2.json has no
// containers by design, so before systems/mining.ts existed nothing ever
// declared one — `desiredMinerCount = min(sources, containers.length)` stayed
// 0, `desiredHaulerCount` stayed 0, and the colony never got past a bootstrap
// + upgrader economy. #12/#13 hid this by injecting containers with
// `addStructure()`; nothing here does that. Every structure asserted below is
// one the bot placed and built under its own power.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bunkerTerrain, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  // bunkerTerrain() is mandatory: stubWorld()'s stock rooms top out at
  // clearance 4 and cannot host a BUNKER_RADIUS=6 bunker, so the anchor stays
  // null forever and no planner — mining included — ever runs.
  colony = await BootedColony.boot({
    botCode: bundleBot(),
    port: 21083,
    terrain: bunkerTerrain(),
    spawnX: 25,
    spawnY: 25
  });
  // Seeded at RCL3 for the same reason as rcl3.test.ts: the natural climb from
  // RCL1 costs tens of thousands of ticks. Containers are gated at RCL2, so
  // this is above the gate without being near the RCL7 link switchover.
  await colony.setControllerLevel(3, 0);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "the colony places and finishes a source container without help",
  async () => {
    // runUntil resolves to the tick the predicate first held, or null on timeout.
    const builtAtTick = await colony.runUntil(
      async () => (await colony.structures("container")).length > 0,
      3000
    );

    expect(builtAtTick, "no container was ever finished within 3000 ticks").not.toBeNull();

    // The payoff the issue is actually after: a container that exists unblocks
    // `desiredMinerCount = min(sources, containers.length)`, which was pinned
    // at 0. Give the spawn room to react — the container finishing and the
    // miner appearing are several hundred ticks apart at this income.
    const minerAtTick = await colony.runUntil(async () => {
      const mem = await colony.memory();
      const creeps = (mem.creeps as Record<string, { role?: string }> | undefined) ?? {};
      return Object.values(creeps).some(c => c.role === "miner");
    }, 1500);

    expect(minerAtTick, "container was built but no miner ever followed").not.toBeNull();
  },
  600_000
);
