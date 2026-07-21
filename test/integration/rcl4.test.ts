// Milestone P2: "storage online by RCL4" (gh issue #20, docs/rewrite-skeleton.md §8).
//
// PARTIAL — the first three rungs of the issue's nine-rung ladder. The rest are
// blocked on `systems/mining.ts`, which is specified in the skeleton (§ file
// tree: "source assignment, container/link placement") but not yet ported from
// MinerOperation.getBuildingList. Source containers are placed per-operation at
// the end of the source road path, NOT by the bunker stamp — Base_2.json
// contains no containers by design. Until that port lands the colony can never
// build a container, so desiredMinerCount (min(sources, containers)) and
// desiredHaulerCount both pin to 0 and no miner, hauler, or storage ever
// follows. A 3000-tick run confirms the colony flatlines at RCL3.
//
// What this file does prove is the half that is ported: the bot plans a bunker
// and places its *own* construction sites, closing the gap that #12/#13 could
// only fake via `addStructure()` injection. The remaining rungs get appended
// here once mining.ts exists.
//
// Seeded at RCL3 rather than climbing from a cold boot. This room's 2 sources
// cap income near 6.67 energy/tick and the RCL3->4 leg alone needs 135,000
// controller progress; a natural climb would be tens of thousands of ticks.
// boot-rcl2.test.ts already covers the early economic climb and rcl3.test.ts
// the RCL2->3 leg, so seeding here (issue #9's setControllerLevel) buys the one
// thing those cannot show: the planning -> placement -> build chain running on
// its own. Everything asserted below is the bot's own doing — nothing is injected.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  // Default room and spawn placement (harness.ts): bunker terrain, spawn on the
  // layout's own spawn tile — so the colony plans around the same geometry it
  // would in a real room. This test needs both: it asserts the anchor is found
  // at all, which stubWorld()'s clearance-4 rooms could never satisfy.
  colony = await BootedColony.boot({ botCode: bundleBot() });
  await colony.setControllerLevel(3);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "the colony computes a bunker anchor and places its own construction sites",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      { name: "anchor computed", by: 400 },
      { name: "construction sites placed", by: 400 }
    ]);

    await colony.runUntil(
      async () => ladder.firstMissed() === null,
      500,
      async tick => {
        const creeps = await colony.creepCount();
        const anchor = await colony.anchor();
        const sites = await colony.sites();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "anchor computed":
              return anchor !== null;
            case "construction sites placed":
              return sites.length > 0;
            default:
              return false;
          }
        });
      }
    );

    // Name the first rung missed → the failure phase is known before reading data.
    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
  },
  180_000
);
