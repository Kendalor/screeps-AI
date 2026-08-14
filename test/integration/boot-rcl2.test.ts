// Foundational integration test: proves end-to-end that spawning, resolveTarget candidate fetch,
// and runStep dispatch actually drive a colony in a real engine — none of that glue is unit-tested.
//
// Observed on the reference machine: first creep ~tick 2, first upgrade ~tick 593, RCL2 ~tick 779.
// Budgets below carry margin for run-to-run pathing variance.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "fresh spawn reaches RCL2 within budget",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      // Bunker anchor optimises for controller proximity, starting the colony further from
      // sources — the long opening round trip is why this budget is later than it looks.
      { name: "controller upgrading", by: 700 },
      { name: "RCL2", by: 1000 }
    ]);

    const reachedRcl2 = await colony.runUntil(
      async () => (await colony.controller()).level >= 2,
      1200,
      async tick => {
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "controller upgrading":
              return ctrl.progress > 0;
            case "RCL2":
              return ctrl.level >= 2;
            default:
              return false;
          }
        });
      }
    );

    const missed = ladder.firstMissed();
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl2, "RCL2 never reached within 1200 ticks").not.toBeNull();
  },
  120_000
);
