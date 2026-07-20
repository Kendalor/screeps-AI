// Emergency recovery: a colony that has lost every creep spawns its way back
// (gh issue #19).
//
// Kept separate from the RCL-growth milestones because it is a qualitatively
// different scenario: a cold restart from zero creeps against pre-existing
// infrastructure, with no dependence on layout or building placement. What it
// proves is that the recovery path in planSpawning survives contact with the
// real engine — that the emitted body is actually affordable at the spawn's
// 300-energy regen floor, and that nothing downstream (dry run, spawn
// direction, memory write) rejects it. A planner unit test cannot show that.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), port: 21079 });
  // Skip the RCL1 warmup (issue #9) so the scenario starts as an established
  // room rather than a fresh spawn — recovery is about losing what you had.
  await colony.setControllerLevel(2);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a colony with no creeps spawns one within the recovery budget",
  async () => {
    // Precondition: the world starts with zero creeps. If this ever fails the
    // scenario below proves nothing, so it is asserted rather than assumed.
    expect(await colony.creepCount(), "scenario must start with no creeps").toBe(0);

    const reached = await colony.runUntil(async () => (await colony.creepCount()) > 0, 300);

    expect(reached, "no creep spawned within 300 ticks of a cold RCL-2 start").not.toBeNull();
  },
  120_000
);
