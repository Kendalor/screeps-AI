// The colony builds its own source container. Base_2.json has no containers by design, so this
// depends on systems/mining.ts placing one — nothing here injects it via addStructure().

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
  // Seeded at RCL3 to skip the tens-of-thousands-of-tick natural climb — above the RCL2
  // container gate without being near the RCL7 link switchover.
  await colony.setControllerLevel(3, 0);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "the colony places and finishes a source container without help",
  async () => {
    const builtAtTick = await colony.runUntil(
      async () => (await colony.structures("container")).length > 0,
      3000
    );

    expect(builtAtTick, "no container was ever finished within 3000 ticks").not.toBeNull();

    // The container finishing and the miner appearing are several hundred ticks apart at this income.
    const minerAtTick = await colony.runUntil(() => colony.hasRole("miner"), 1500);

    expect(minerAtTick, "container was built but no miner ever followed").not.toBeNull();
  },
  600_000
);
