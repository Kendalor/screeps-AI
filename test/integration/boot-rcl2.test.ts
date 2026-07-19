// Milestone 1: a fresh spawn boots a colony to RCL2 (docs/rewrite-skeleton.md §8).
//
// This is the foundational integration test — proving end-to-end that spawning
// (desired-vs-actual census diff), resolveTarget candidate fetch, and runStep
// dispatch actually drive a colony in a real engine. None of that glue is
// unit-tested by design; this is where it is verified.
//
// Observed on the reference machine: first creep ~tick 10, RCL2 ~tick 573.
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
      { name: "controller upgrading", by: 500 },
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
    // Name the first rung missed → the failure phase is known before reading data.
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl2, "RCL2 never reached within 1200 ticks").not.toBeNull();
  },
  120_000
);
