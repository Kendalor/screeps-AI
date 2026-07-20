// Milestone 2: a colony spawns a dedicated upgrader alongside bootstrap and
// finishes the climb into RCL3 (gh issue #10, docs/rewrite-skeleton.md §8).
//
// The full natural climb from RCL1 is impractical to run routinely: this
// room's 2 sources cap income at ~6.67 energy/tick, and RCL2->3 alone needs
// 45,000 controller progress — tens of thousands of ticks at the observed
// rate. boot-rcl2.test.ts already covers that early economic climb, so this
// scenario seeds the controller at RCL2 with progress 100 short of RCL3 (via
// the setControllerLevel harness helper, gh issue #9) and lets the bot's own
// behavior — spawning, the upgrader census/step chain, upgradeController —
// finish the last mile for real. Budgets carry margin for run-to-run pathing
// variance.

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

async function hasUpgrader(): Promise<boolean> {
  const mem = await colony.memory();
  const creeps = (mem.creeps as Record<string, { role?: string }> | undefined) ?? {};
  return Object.values(creeps).some(c => c.role === "upgrader");
}

test(
  "seeded near RCL3, the colony spawns an upgrader and finishes the climb",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      { name: "RCL2", by: 1000 },
      { name: "upgrader spawned", by: 1500 },
      { name: "RCL3", by: 4500 }
    ]);

    const reachedRcl3 = await colony.runUntil(
      async () => (await colony.controller()).level >= 3,
      5000,
      async tick => {
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        const upgraderAlive = await hasUpgrader();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "RCL2":
              return ctrl.level >= 2;
            case "upgrader spawned":
              return upgraderAlive;
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
