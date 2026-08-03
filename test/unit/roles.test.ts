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

describe("repair body", () => {
  const body = (energy: number) => ROLES.repair.body(energy);

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
});

describe("repair role", () => {
  it("prefers the most-damaged structure below 50% hits, falls back to the nearest damaged one, then refills", () => {
    const steps = roleDef("repair")?.steps ?? [];
    // Cross-room assignment first, mirroring builder's buildTargetRoom step — a no-op once already there.
    const moveStep = steps[0];
    expect(moveStep.do).toBe("moveToRoom");
    expect(moveStep.do === "moveToRoom" && moveStep.to).toBe("repairTargetRoom");
    // Tier 1: an emergency-level target (<50% hits), most damaged first — worth crossing the room for.
    const first = steps[1];
    expect(first.do).toBe("repair");
    expect(first.do === "repair" && first.at).toMatchObject({ where: "damaged", repairBelow: 0.5, prefer: "mostDamaged" });
    // Tier 2: any decay at all, nearest first — mopping up minor damage stays local instead of crisscrossing.
    const second = steps[2];
    expect(second.do).toBe("repair");
    expect(second.do === "repair" && second.at).toMatchObject({ where: "damaged", prefer: "nearest" });
    expect(second.do === "repair" && (second.at as { repairBelow?: number }).repairBelow).toBeUndefined();
    // Gather sits ahead of self-harvest so a repairer draws from stores/drops before mining itself.
    expect(steps.map(s => s.do)).toEqual(["moveToRoom", "repair", "repair", "gather", "harvest"]);
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
  it("gathers from the nearest of drop/storage/container, falling back to harvest, before building — never from haulers", () => {
    expect(roleDef("builder")).toBe(ROLES.builder);
    expect(roleDef("builder")?.steps).toEqual([
      {
        do: "gather",
        from: {
          find: "any",
          of: [
            { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
            { find: "dropped", unlessSpawnNeedsEnergy: true }
          ],
          prefer: "nearest"
        }
      },
      { do: "harvest", from: { find: "source" } },
      { do: "moveToRoom", to: "buildTargetRoom", avoidDanger: true },
      { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
    ]);
    // A hauler drained mid-run can't deliver its load to the spawn/extensions, so the builder must
    // never steal from it — the same rule the upgrader follows.
    const gatherSpec = roleDef("builder")?.steps.find(s => s.do === "gather");
    const members = gatherSpec?.from.find === "any" ? gatherSpec.from.of : [];
    expect(members).not.toContainEqual({ find: "creep", role: "hauler", where: "hasEnergy" });
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

  it("is always a valid, affordable body with WORK, across every remote/reserved combination", () => {
    for (const ctx of [
      {},
      { remote: true, reserved: false },
      { remote: true, reserved: true }
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

  // CARRY is a flat rule now: every miner body (local or remote, any container/link state) gets exactly
  // one once the room can afford it — hasContainer/hasContainerSite no longer gate it at all.
  it("carries exactly one CARRY once energy reaches the threshold, regardless of container/link state", () => {
    for (const e of ENERGY_LEVELS.filter(e => e >= 350)) {
      for (const ctx of [{}, { hasContainer: true }, { hasContainer: true, hasLink: true }, { remote: true, reserved: false }]) {
        const b = body(e, ctx);
        expect(b.filter(p => p === CARRY).length).toBe(1);
      }
    }
  });

  it("drops CARRY entirely below the threshold, regardless of container/link state", () => {
    for (const e of ENERGY_LEVELS.filter(e => e < 350)) {
      for (const ctx of [{}, { hasContainer: true }, { hasContainer: true, hasLink: true }]) {
        expect(body(e, ctx)).not.toContain(CARRY);
      }
    }
  });

  it("targets 6 WORK locally and for a reserved remote, but only 3 for an unreserved remote", () => {
    const rich = (ctx: Partial<Parameters<typeof ROLES.miner.body>[1]>) => body(50_000, ctx);
    expect(rich({}).filter(p => p === WORK).length).toBe(6);
    expect(rich({ remote: true, reserved: true }).filter(p => p === WORK).length).toBe(6);
    expect(rich({ remote: true, reserved: false }).filter(p => p === WORK).length).toBe(3);
  });

  it("never exceeds its WORK ceiling however rich the room", () => {
    for (const ctx of [{}, { remote: true, reserved: true }, { remote: true, reserved: false }]) {
      const rich = body(50_000, ctx);
      const ceiling = ctx.remote && !ctx.reserved ? 3 : 6;
      expect(rich.filter(p => p === WORK).length).toBeLessThanOrEqual(ceiling);
    }
  });

  it("pairs WORK 1:1 with MOVE for a remote (no road assumed), vs the cheaper ~2:1 ratio locally", () => {
    const local = body(50_000, {});
    const remote = body(50_000, { remote: true, reserved: true });
    expect(local.filter(p => p === MOVE).length).toBe(Math.ceil(local.filter(p => p === WORK).length / 2));
    expect(remote.filter(p => p === MOVE).length).toBe(remote.filter(p => p === WORK).length);
  });

  it("grows (or holds) as energy increases, never shrinks", () => {
    expectNonDecreasing((e: number) => body(e));
    expectNonDecreasing((e: number) => body(e, { remote: true, reserved: false }));
    expectNonDecreasing((e: number) => body(e, { remote: true, reserved: true }));
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
  it("upkeeps its own container (repair < 70%, build the site) before harvesting, then link over container", () => {
    expect(roleDef("miner")).toBe(ROLES.miner);
    expect(roleDef("miner")?.steps).toEqual([
      // Remote miners walk to their source's room first (targetRoom set at spawn); a local miner has no
      // targetRoom so this no-ops and the interpreter advances to harvesting.
      { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
      // Repair its own source container once it drops below 70% hits; scoped to the assigned source so a
      // miner never repairs another source's container. Only fires when the miner carries energy.
      { do: "repair", at: { find: "structure", type: [STRUCTURE_CONTAINER], where: "damaged", near: "assignedSource", repairBelow: 0.7 } },
      // Help build the container site at its own source (never some other nearest site).
      { do: "build", at: { find: "constructionSite", structureType: STRUCTURE_CONTAINER, near: "assignedSource" } },
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_LINK], where: "notFull", near: "assignedSource" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "assignedSource" } }
    ]);
  });
});

describe("hauler role", () => {
  it("collects until full, then delivers spawn/extensions first, controller container, storage, tower, and finally a consumer until empty", () => {
    expect(roleDef("hauler")).toBe(ROLES.hauler);
    expect(roleDef("hauler")?.steps).toEqual([
      // Collect phase: one pooled gather over containers, drops, tombstones and ruins, ranked by
      // largest load, until full (no when-gate — a gather step is complete only at free===0, so the
      // loop stays here until the store is full).
      {
        do: "gather",
        from: {
          find: "any",
          of: [
            // Source containers only (near: notController) — never the controller container it fills.
            // requireReachableAlive: skip a pickup this hauler would die en route to.
            { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy", near: "notController", requireReachableAlive: true },
            { find: "dropped", requireReachableAlive: true },
            { find: "tombstone", requireReachableAlive: true },
            { find: "ruin", requireReachableAlive: true }
          ],
          prefer: "largest"
        }
      },
      // Deliver phase: closest matching sink each step (resolveTarget picks the nearest by path),
      // running until empty before the loop wraps back to the collect phase. Spawn + extensions come
      // FIRST — a room that can't spawn is dead, and pre-storage the hauler is the only thing filling
      // them (no supply unit exists yet). Post-storage the supply unit keeps them full, so this step
      // finds nothing and the hauler falls through to the controller container (topped to a 70% floor so
      // upgraders stay fed) and then storage — the phase switch is pure step ordering.
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "controller", fillTo: 0.7 } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_STORAGE], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
      // With every fixed sink full, feed a consumer directly rather than hold or drop energy.
      // oneShot: an actively-working consumer never truly goes not-full, so one transfer is enough
      // before the loop re-scans every sink from the top instead of pinning to this one target.
      { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull", prefer: "nearest" }, oneShot: true }
    ]);
  });
});

// Supply is a Logistics-owned mover, same as transport: no static step table of its own — assignment
// (storage or the nearest local pile in, spawn/extension/tower out, never a remote pickup) comes from
// planLogistics via memory.logistics. See test/unit/logistics/ for the provider/consumer graph that
// governs it (graph.ts's supplyProviders/supplyConsumers) and test/unit/roles.test.ts's own empty-steps
// assertion below for why runCreepBehaviors diverts it before the step-table dispatch.
describe("supply role", () => {
  it("has no step table — assignment is Logistics-owned", () => {
    expect(roleDef("supply")).toBe(ROLES.supply);
    expect(roleDef("supply")?.steps).toEqual([]);
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
  it("gathers, then builds outstanding sites before upgrading — never from haulers", () => {
    expect(roleDef("upgrader")).toBe(ROLES.upgrader);
    expect(roleDef("upgrader")?.steps).toEqual([
      // Container/storage/link/drop/tombstone/ruin pooled into one gather step: the nearest source wins.
      {
        do: "gather",
        from: {
          find: "any",
          of: [
            { find: "structure", type: [STRUCTURE_CONTAINER, STRUCTURE_STORAGE, STRUCTURE_LINK], where: "hasEnergy" },
            { find: "dropped", unlessSpawnNeedsEnergy: true },
            { find: "tombstone" },
            { find: "ruin" }
          ],
          prefer: "nearest"
        }
      },
      // Build outstanding sites first; only fall through to upgrade when none remain to resolve.
      // A 1-CARRY body skips sites farther than 7 from the controller — too far a round trip to refill.
      { do: "build", at: { find: "constructionSite", prefer: "mostProgress", onlyIfCarryOver: { carry: 1, range: 7 } } },
      { do: "upgrade" }
    ]);
    // A hauler drained mid-run can't deliver its load, so the upgrader must never steal from it.
    const gatherSpec = roleDef("upgrader")?.steps.find(s => s.do === "gather");
    const members = gatherSpec?.from.find === "any" ? gatherSpec.from.of : [];
    expect(members).not.toContainEqual({ find: "creep", role: "hauler", where: "hasEnergy" });
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
describe("claimer body", () => {
  const body = (energy: number) => ROLES.claimer.body(energy, { hasContainer: false, hasLink: false });

  it("has at least one CLAIM and one MOVE, valid across the energy ramp", () => {
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expect(b).toContain(CLAIM);
      // never proposes a body it can't afford (CLAIM is 600, so a floored minimum is allowed below that)
      expect(bodyCost(b)).toBeLessThanOrEqual(Math.max(e, bodyCost(b)));
    }
  });

  it("adds more CLAIM parts as energy grows (faster reservation)", () => {
    const small = body(650).filter(p => p === CLAIM).length;
    const large = body(2000).filter(p => p === CLAIM).length;
    expect(large).toBeGreaterThan(small);
  });
});

describe("claimer role", () => {
  it("walks to its target room, then reserves the controller", () => {
    expect(roleDef("claimer")).toBe(ROLES.claimer);
    expect(roleDef("claimer")?.steps).toEqual([
      { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
      { do: "reserve" }
    ]);
  });
});

describe("colonizer body", () => {
  const body = (energy: number) => ROLES.colonizer.body(energy, { hasContainer: false, hasLink: false });

  it("has at least one CLAIM and one MOVE, valid across the energy ramp", () => {
    for (const e of ENERGY_LEVELS) {
      const b = body(e);
      expectValidBody(b);
      expect(b.filter(p => p === CLAIM).length).toBe(b.filter(p => p === MOVE).length);
      expect(b).toContain(CLAIM);
    }
  });

  it("floors at 1 CLAIM + 1 MOVE below 2-set affordability", () => {
    const b = body(650);
    expect(b.filter(p => p === CLAIM).length).toBe(1);
    expect(b.filter(p => p === MOVE).length).toBe(1);
  });

  it("grows to 2 CLAIM + 2 MOVE once affordable — attackController against a reserved controller scales with CLAIM count", () => {
    const b = body(1300);
    expect(b.filter(p => p === CLAIM).length).toBe(2);
    expect(b.filter(p => p === MOVE).length).toBe(2);
  });

  it("caps at 2 CLAIM sets — claimController itself never uses more than one", () => {
    expect(bodyCost(body(10_000))).toBe(bodyCost(body(1300)));
  });
});

describe("colonizer role", () => {
  it("walks to its target room, then claims the controller once", () => {
    expect(roleDef("colonizer")).toBe(ROLES.colonizer);
    expect(roleDef("colonizer")?.steps).toEqual([
      { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
      { do: "claim", oneShot: true }
    ]);
  });
});

describe("settler body", () => {
  const body = (energy: number) => ROLES.settler.body(energy, { hasContainer: false, hasLink: false });

  it("produces a valid, affordable body across the energy range", () => {
    for (const e of ENERGY_LEVELS) {
      expectValidBody(body(e));
      expectAffordable(body, e);
    }
  });

  it("always carries at least one WORK part, like Bootstrap", () => {
    for (const e of ENERGY_LEVELS) {
      expect(body(e)).toContain(WORK);
    }
  });
});

describe("settler role", () => {
  it("renews first, then walks to its target room, then runs the bootstrap wraparound loop", () => {
    expect(roleDef("settler")).toBe(ROLES.settler);
    expect(roleDef("settler")?.steps).toEqual([
      { do: "renew", below: 500 },
      { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
      { do: "pickup", from: { find: "dropped", prefer: "largest" } },
      { do: "harvest", from: { find: "source" } },
      { do: "build", at: { find: "constructionSite", structureType: STRUCTURE_SPAWN } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
      { do: "build" },
      { do: "upgrade" }
    ]);
  });
});

describe("attacker body", () => {
  const body = (energy: number) => ROLES.attacker.body(energy, { hasContainer: false, hasLink: false });

  it("is valid and affordable across the energy ramp", () => {
    for (const e of ENERGY_LEVELS) {
      expectValidBody(body(e));
      expectAffordable(body, e);
    }
  });

  it("keeps a fixed 1 TOUGH : 2 ATTACK : 3 MOVE ratio per set", () => {
    for (const e of ENERGY_LEVELS.filter(e => e >= 320)) {
      const b = body(e);
      const tough = b.filter(p => p === TOUGH).length;
      const attack = b.filter(p => p === ATTACK).length;
      const move = b.filter(p => p === MOVE).length;
      expect(attack).toBe(tough * 2);
      expect(move).toBe(tough * 3);
    }
  });

  it("grows with energy up to the 5-set cap, then stops", () => {
    const small = bodyCost(body(320));
    const large = bodyCost(body(1600));
    const beyond = bodyCost(body(10_000));
    expect(large).toBeGreaterThan(small);
    expect(beyond).toBe(large);
  });

  it("floors at exactly one TOUGH even below its cost — the operation gates affordability, not the body formula", () => {
    expect(body(0).filter(p => p === TOUGH).length).toBe(1);
  });
});

describe("attacker role", () => {
  it("walks to its assigned attack target room, attacks any invader core, then fights whatever's there", () => {
    expect(roleDef("attacker")).toBe(ROLES.attacker);
    // attack (not dismantle) against the core: this body is TOUGH/ATTACK/MOVE only, no WORK part, and
    // dismantle() requires one (ERR_NO_BODYPART) — attackStep's structure branch (interpreter.ts) covers
    // creep.attack() against a Structure exactly as it does a Creep.
    expect(roleDef("attacker")?.steps).toEqual([
      { do: "moveToRoom", to: "attackTargetRoom" },
      { do: "attack", from: { find: "structure", type: [STRUCTURE_INVADER_CORE] } },
      { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } }
    ]);
  });
});
