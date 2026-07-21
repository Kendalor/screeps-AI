// Milestone 1: a fresh spawn boots a colony to RCL2 (docs/rewrite-skeleton.md §8).
//
// This is the foundational integration test — proving end-to-end that spawning
// (desired-vs-actual census diff), resolveTarget candidate fetch, and runStep
// dispatch actually drive a colony in a real engine. None of that glue is
// unit-tested by design; this is where it is verified.
//
// Runs in the harness's default room: bunker terrain with the spawn on the
// layout's own spawn tile, the same geometry every other scenario uses, since
// the bunker is the only layout the bot has.
//
// Observed on the reference machine: first creep ~tick 2, first upgrade ~tick
// 593, RCL2 ~tick 779. Budgets below carry margin for run-to-run pathing
// variance.

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
      // Later than it looks like it should be, because the bunker anchor
      // optimises for controller proximity (CONTROLLER_WEIGHT) and so starts the
      // colony *further from its sources*: the opening round trip is long, and
      // nothing reaches the controller until it completes. The trade pays for
      // itself immediately after — the short controller haul is why RCL2 still
      // lands well inside its own budget. Budgeted off the on-layout geometry;
      // the old 500 assumed a spawn parked near the sources, which no real
      // bunker colony enjoys.
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
    // Name the first rung missed → the failure phase is known before reading data.
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl2, "RCL2 never reached within 1200 ticks").not.toBeNull();
  },
  120_000
);
