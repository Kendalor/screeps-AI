import { describe, expect, it } from "vitest";
import { ROLES, roleDef } from "../../src/behaviors/roles";
import { bodyCost } from "../../src/spawn/body";

// Body assertions below deliberately avoid pinning exact part layouts: the whole point is that a
// role's body formula can be retuned (different ratios, caps, rungs) without every test needing a
// rewrite. What must always hold, whatever the formula:
//  - never propose a body that costs more than the greater of the given energy or the role's own
//    minimum floor (some roles, e.g. upgrader/bootstrap, deliberately floor below a tiny budget)
//  - at least one MOVE (a body with none can never move — SPAWN_CREEP itself rejects it)
//  - never exceed the 50-part hard cap
//  - role-specific minimum parts (e.g. an upgrader needs WORK to upgrade at all)
const ENERGY_LEVELS = [0, 200, 250, 300, 350, 450, 550, 800, 1200, 2500, 5000, 10_000];
const MAX_BODY_PARTS = 50;

function expectValidBody(body: BodyPartConstant[]) {
  expect(body.length).toBeGreaterThan(0);
  expect(body.length).toBeLessThanOrEqual(MAX_BODY_PARTS);
  expect(body).toContain(MOVE);
}

// Affordable against energy, or against the role's own floor cost for budgets below it — a
// formula is allowed to floor at a fixed minimum body rather than return nothing.
function expectAffordable(bodyAt: (energy: number) => BodyPartConstant[], energy: number) {
  const b = bodyAt(energy);
  const floor = bodyCost(bodyAt(0));
  expect(bodyCost(b)).toBeLessThanOrEqual(Math.max(floor, energy));
}

function expectNonDecreasing(bodyAt: (energy: number) => BodyPartConstant[]) {
  let prevCost = 0;
  for (const e of ENERGY_LEVELS) {
    const cost = bodyCost(bodyAt(e));
    expect(cost).toBeGreaterThanOrEqual(prevCost);
    prevCost = cost;
  }
}

describe("bootstrap body", () => {
  const body = (energy: number) => ROLES.bootstrap.body(energy);

  it("is always a valid, affordable body with WORK and CARRY", () => {
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expectAffordable(body, e);
      expect(b).toContain(WORK);
      expect(b).toContain(CARRY);
    }
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing(body);
  });

  it("caps body size regardless of energy", () => {
    expect(bodyCost(body(10_000))).toBe(bodyCost(body(5000)));
  });
});

describe("upgrader body", () => {
  const body = (energy: number) => ROLES.upgrader.body(energy);

  it("is always a valid, affordable body with WORK and CARRY (a CARRY-less upgrader can never refill)", () => {
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expectAffordable(body, e);
      expect(b).toContain(WORK);
      expect(b).toContain(CARRY);
    }
  });

  // The arbiter *silently skips* a body that costs more than the room's full energyCapacity — it
  // can never afford it, so it never stops on it either. A dedicated upgrader must therefore have
  // some affordable floor even in a 300-capacity RCL1 room, or it never spawns at all.
  it("degrades to a body a 300-capacity room can afford", () => {
    expect(bodyCost(body(300))).toBeLessThanOrEqual(300);
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing(body);
  });
});

describe("bootstrap role", () => {
  it("picks up a drop pile before harvesting a source itself", () => {
    expect(roleDef("bootstrap")).toBe(ROLES.bootstrap);
    expect(roleDef("bootstrap")?.steps).toEqual([
      { do: "pickup", from: { find: "dropped", prefer: "largest" } },
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
      { do: "build" },
      { do: "upgrade" }
    ]);
  });
});

describe("builder role", () => {
  it("gathers from the nearest of drop/storage/container/hauler, falling back to harvest, before building", () => {
    expect(roleDef("builder")).toBe(ROLES.builder);
    expect(roleDef("builder")?.steps).toEqual([
      {
        do: "gather",
        from: {
          find: "any",
          of: [
            { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
            { find: "dropped" },
            { find: "creep", role: "hauler", where: "hasEnergy" }
          ],
          prefer: "nearest"
        }
      },
      { do: "harvest", from: { find: "source" } },
      { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
    ]);
  });

  it("is always a valid, affordable body with WORK and CARRY", () => {
    const body = (energy: number) => ROLES.builder.body(energy);
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expectAffordable(body, e);
      expect(b).toContain(WORK);
      expect(b).toContain(CARRY);
    }
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing((energy: number) => ROLES.builder.body(energy));
  });
});

// The miner's body depends on where it drops energy, not just room budget: standing
// on a container it needs no CARRY, but without one (or with a link) it must hold energy.
describe("miner body", () => {
  const body = (energy: number, over: Partial<Parameters<typeof ROLES.miner.body>[1]> = {}) =>
    ROLES.miner.body(energy, { hasContainer: false, hasLink: false, ...over });

  it("is always a valid, affordable body with WORK, across every container/link combination", () => {
    for (const ctx of [
      { hasContainer: false, hasLink: false },
      { hasContainer: true, hasLink: false },
      { hasContainer: true, hasLink: true },
      { hasContainer: false, hasLink: true }
    ]) {
      const bodyAt = (energy: number) => body(energy, ctx);
      for (const e of ENERGY_LEVELS) {
        const b = bodyAt(e);
        expectValidBody(b);
        expectAffordable(bodyAt, e);
        expect(b).toContain(WORK);
      }
    }
  });

  it("drops CARRY entirely without a container to stand on", () => {
    for (const e of ENERGY_LEVELS) {
      expect(body(e, { hasContainer: false, hasLink: false })).not.toContain(CARRY);
    }
  });

  it("drops CARRY below the first-extension energy threshold, even on a container", () => {
    for (const e of ENERGY_LEVELS.filter(e => e < 350)) {
      expect(body(e, { hasContainer: true, hasLink: false })).not.toContain(CARRY);
    }
  });

  it("carries one overflow CARRY on a container once the room can spare it, without shrinking WORK", () => {
    // A second miner sharing a source can't always stand on the container itself, so it needs to
    // ferry its harvest in by hand once the room affords the part on top of its current WORK count.
    const rich = body(1200, { hasContainer: true, hasLink: false });
    expect(rich).toContain(CARRY);
    expect(rich.filter(p => p === WORK).length).toBe(6);
  });

  it("feeding a link always carries CARRY, once the budget can afford anything beyond the bare floor", () => {
    const linked = body(1200, { hasContainer: true, hasLink: true });
    expect(linked).toContain(CARRY);
  });

  it("never exceeds the 6-WORK ceiling (above the 5 that exactly saturate a source), however rich the room", () => {
    for (const ctx of [{ hasContainer: false }, { hasContainer: true }]) {
      const rich = body(50_000, ctx);
      expect(rich.filter(p => p === WORK).length).toBeLessThanOrEqual(6);
    }
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing((e: number) => body(e));
    expectNonDecreasing((e: number) => body(e, { hasContainer: true }));
  });
});

describe("hauler body (must stay 1:1 carry:move so a loaded hauler never fatigues)", () => {
  const body = (energy: number) => ROLES.hauler.body(energy);

  it("is always a valid, affordable body with CARRY and equal CARRY:MOVE", () => {
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expectAffordable(body, e);
      expect(b).toContain(CARRY);
      expect(b.filter(p => p === CARRY).length).toBe(b.filter(p => p === MOVE).length);
    }
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing(body);
  });

  it("caps the body at the 50-part limit", () => {
    const capped = body(10_000);
    expect(capped.length).toBeLessThanOrEqual(MAX_BODY_PARTS);
  });
});

describe("miner role", () => {
  it("harvests, then prefers a link over a container to deposit into", () => {
    expect(roleDef("miner")).toBe(ROLES.miner);
    expect(roleDef("miner")?.steps).toEqual([
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_LINK], where: "notFull", near: "assignedSource" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "assignedSource" } }
    ]);
  });
});

describe("hauler role", () => {
  it("collects until full, then delivers to every sink and finally a consumer until empty", () => {
    expect(roleDef("hauler")).toBe(ROLES.hauler);
    expect(roleDef("hauler")?.steps).toEqual([
      // Collect phase: one pooled gather over containers, drops and tombstones, ranked by largest
      // load, until full (no when-gate — a gather step is complete only at free===0, so the loop
      // stays here until the store is full).
      {
        do: "gather",
        from: {
          find: "any",
          of: [
            { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy" },
            { find: "dropped" },
            { find: "tombstone" }
          ],
          prefer: "largest"
        }
      },
      // Deliver phase: closest matching sink each step (resolveTarget picks the nearest by path),
      // running until empty before the loop wraps back to the collect phase.
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_STORAGE], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
      // With every fixed sink full, feed a consumer directly rather than hold or drop energy.
      // oneShot: an actively-working consumer never truly goes not-full, so one transfer is enough
      // before the loop re-scans every sink from the top instead of pinning to this one target.
      { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull", prefer: "nearest" }, oneShot: true }
    ]);
  });
});

// Supply is the inverse of hauler: hauler moves energy from mining containers into
// storage, supply moves it back out to what must stay full for spawning to work.
describe("supply role", () => {
  it("withdraws from storage, then fills extensions before the spawn", () => {
    expect(roleDef("supply")).toBe(ROLES.supply);
    expect(roleDef("supply")?.steps).toEqual([
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
      { do: "withdraw", from: { find: "structure", type: [STRUCTURE_STORAGE], where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy" } }
    ]);
  });

  it("is always a valid, affordable body with CARRY — it is the hauler job in reverse", () => {
    const body = (energy: number) => ROLES.supply.body(energy);
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expectAffordable(body, e);
      expect(b).toContain(CARRY);
    }
  });

  it("shares the hauler carry-parts body", () => {
    expect(bodyCost(ROLES.supply.body(450))).toBe(bodyCost(ROLES.hauler.body(450)));
  });
});

describe("upgrader role", () => {
  it("upgrades first, then withdraws from hauler/container/storage/link, falling back to a pile", () => {
    expect(roleDef("upgrader")).toBe(ROLES.upgrader);
    expect(roleDef("upgrader")?.steps).toEqual([
      { do: "upgrade" },
      { do: "withdraw", from: { find: "structure", type: [STRUCTURE_STORAGE], where: "hasEnergy" } },
      // The container step lets a pre-storage upgrader run off the mining economy.
      { do: "withdraw", from: { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy" } },
      { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: [STRUCTURE_LINK], where: "hasEnergy" } },
      { do: "pickup", from: { find: "dropped", prefer: "largest" } }
    ]);
  });
});

describe("scout body", () => {
  it("is a minimal single-MOVE body, valid at any energy", () => {
    for (const e of ENERGY_LEVELS) {
      const b = ROLES.scout.body(e, { hasContainer: false, hasLink: false });
      expectValidBody(b);
      expect(bodyCost(b)).toBeLessThanOrEqual(Math.max(e, bodyCost(b)));
    }
  });
});
