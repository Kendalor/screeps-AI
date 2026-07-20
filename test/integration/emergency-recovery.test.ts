// Emergency recovery: a colony that has lost every creep spawns its way back
// (gh issue #19).
//
// Kept separate from the RCL-growth milestones because it is a qualitatively
// different scenario: a cold restart from zero creeps against pre-existing
// infrastructure, with no dependence on layout or building placement.
//
// The scenario is built so the RECOVERY branch is the only thing that can
// satisfy it. A cold room with sources would spawn a bootstrap via the normal
// quota path regardless, proving nothing — so this room is given storage full
// of energy, which makes recovery choose `supply`. Asserting on the role (not
// merely "a creep exists") is what ties the test to the branch under test.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), port: 21079 });
  // Skip the RCL1 warmup (issue #9): recovery is about losing what you had, so
  // the room starts established rather than as a fresh spawn.
  await colony.setControllerLevel(4); // RCL4 is the first level that allows storage
  await colony.addStructure("storage", 21, 30, {
    store: { energy: 50_000 },
    storeCapacity: 1_000_000
  });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a wiped colony with stored energy spawns a supply creep to refill itself",
  async () => {
    // Preconditions: if either fails the scenario proves nothing, so both are
    // asserted rather than assumed.
    expect(await colony.creepCount(), "scenario must start with no creeps").toBe(0);
    const objects = await colony.roomObjects();
    expect(
      objects.find(o => o.type === "storage")?.store?.energy,
      "storage must start stocked — it is what makes recovery pick supply"
    ).toBe(50_000);

    const reached = await colony.runUntil(async () => (await colony.creepCount()) > 0, 300);
    expect(reached, "no creep spawned within 300 ticks of a cold start").not.toBeNull();

    // The recovery branch is what chose this role; the normal quota path would
    // have produced a bootstrap or a miner here.
    const mem = (await colony.memory()) as { creeps?: Record<string, { role?: string }> };
    const roles = Object.values(mem.creeps ?? {}).map(c => c.role);
    expect(roles, `recovery should spawn a supply creep, got ${JSON.stringify(roles)}`).toContain(
      "supply"
    );
  },
  120_000
);
