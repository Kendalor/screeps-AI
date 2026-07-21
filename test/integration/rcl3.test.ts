// Milestone 2: a colony finishes the climb into RCL3 under its own behavior
// (gh issue #10, docs/rewrite-skeleton.md §8).
//
// The full natural climb from RCL1 is impractical to run routinely: this
// room's 2 sources cap income at ~6.67 energy/tick, and RCL2->3 alone needs
// 45,000 controller progress — tens of thousands of ticks at the observed
// rate. boot-rcl2.test.ts already covers that early economic climb, so this
// scenario seeds the controller at RCL2 with progress 100 short of RCL3 (via
// the setControllerLevel harness helper, gh issue #9) and lets the bot's own
// behavior — spawning, the census/step chain, upgradeController — finish the
// last mile for real. The last 100 progress is now closed by the bootstrap
// creeps' own upgrade step before a dedicated upgrader is spawned (gh #23), so
// this asserts the climb completes, not which role completed it. Budgets carry
// margin for run-to-run pathing variance.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), port: 21079 });
  await colony.setControllerLevel(2, 44_900);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "seeded near RCL3, the colony finishes the climb under its own behavior",
  async () => {
    // No "upgrader spawned" rung: seeded only 100 progress short of RCL3, the
    // colony now closes that gap with its bootstrap creeps' own upgrade step
    // before the census ever asks for a dedicated upgrader (gh #23 made those
    // creeps carry 2 WORK and stay lean pre-RCL2, so the last mile is fast).
    // The milestone is reaching RCL3 in budget, not the mechanism that got
    // there — assert the end, not the means.
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
    // Name the first rung missed → the failure phase is known before reading data.
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl3, "RCL3 never reached within 5000 ticks").not.toBeNull();
  },
  180_000
);
