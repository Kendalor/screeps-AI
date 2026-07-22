// PARTIAL milestone toward "storage online by RCL4": proves the bot plans a bunker and places its
// own construction sites at RCL4. The rest is blocked on systems/mining.ts (container/link
// placement) — until that lands, minerRequests and haulerRequests stay pinned at 0.
//
// Seeded at RCL3 rather than a cold boot: this room's income caps near 6.67 energy/tick and the
// RCL3->4 leg alone needs 135,000 controller progress. Everything asserted below is the bot's
// own doing — nothing is injected.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  // Default room (harness.ts): this test asserts the anchor is found at all, which
  // stubWorld()'s clearance-4 rooms could never satisfy.
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

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
  },
  180_000
);
