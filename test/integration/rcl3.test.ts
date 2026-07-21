// A colony finishes the climb into RCL3 under its own behavior. The natural climb from RCL1 is
// impractical to run routinely (RCL2->3 alone needs 45,000 controller progress at ~6.67 energy/tick
// income), so this seeds the controller 100 progress short of RCL3 and lets the bot's own behavior
// finish the last mile. Asserts the climb completes, not which role completes it.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
  await colony.setControllerLevel(2, 44_900);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "seeded near RCL3, the colony finishes the climb under its own behavior",
  async () => {
    // No "upgrader spawned" rung: bootstrap creeps close the last 100 progress themselves
    // before the census asks for a dedicated upgrader — assert the end, not the means.
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      { name: "RCL2", by: 1000 },
      { name: "RCL3", by: 4500 }
    ]);

    const reachedRcl3 = await colony.runUntil(
      async () => (await colony.controller()).level >= 3,
      5000,
      async tick => {
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "RCL2":
              return ctrl.level >= 2;
            case "RCL3":
              return ctrl.level >= 3;
            default:
              return false;
          }
        });
      }
    );

    const missed = ladder.firstMissed();
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl3, "RCL3 never reached within 5000 ticks").not.toBeNull();
  },
  180_000
);
