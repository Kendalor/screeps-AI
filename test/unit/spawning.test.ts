import { describe, expect, it } from "vitest";
import { desiredBootstrapCount, planSpawning } from "../../src/systems/spawning";
import { colony, containerAt, empire, sourceAt, spawn } from "../fixtures";

// "the bootstrap quota is already met" — derived from the quota rather than
// hardcoded, so these fixtures keep meaning that if the sizing changes. The
// quota depends on controllerLevel (lean pre-RCL2), so callers pass the same
// level their scenario uses.
function bootstrapMet(over: Parameters<typeof colony>[0] = {}): number {
  return desiredBootstrapCount(colony(over));
}

describe("spawning planner", () => {
  it("spawns a bootstrap when the colony is below quota", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }],
        energyAvailable: 300,
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "bootstrap",
        body: [WORK, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "bootstrap" }
      }
    ]);
  });

  // Damage consumes body parts in array order, so what the planner emits — not
  // what the body formula happens to assemble — is what decides which parts a
  // creep keeps under fire. A multi-set body is the case where the two differ:
  // the formula groups parts per set, the intent must be sorted by priority.
  it("orders the spawned body so the most valuable parts are destroyed last", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 750,
        energyCapacity: 750,
        sources: [sourceAt(20, 10)]
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ kind: "spawn", role: "bootstrap" });

    const body = (intent as { body: BodyPartConstant[] }).body;
    expect(body).toEqual([WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]);
    // The property behind the expectation: no part outranks one before it.
    const rank = (p: BodyPartConstant) => [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE].indexOf(p);
    for (let i = 1; i < body.length; i++) {
      expect(rank(body[i])).toBeGreaterThanOrEqual(rank(body[i - 1]));
    }
  });

  it("emits nothing when the census already meets quota", () => {
    const snap = empire(
      colony({
        // 1 source; no containers so no miners or haulers, and RCL1 wants no
        // upgraders. Every quota met.
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)] }) },
        spawns: [spawn()],
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("does not spawn from a busy spawn", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn("spawn1", true)],
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("spawns an upgrader once storage exists and higher-priority quotas are met", () => {
    const snap = empire(
      colony({
        // 1 source, no containers -> bootstrap/miner quotas met; storage present
        // so a dedicated upgrader is now warranted (needs storage to withdraw).
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)], controllerLevel: 4 }) },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        storageEnergy: 200_000,
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "upgrader",
        body: [WORK, CARRY, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "upgrader" }
      }
    ]);
  });

  it("does not spawn miners before a container exists to receive them", () => {
    // A miner with no container has nowhere to put energy: it fills its one
    // CARRY and stalls, starving the upgrade that gets the colony to RCL2.
    const snap = empire(
      colony({
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10), sourceAt(30, 40)] }) },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10), sourceAt(30, 40)],
        containers: []
      })
    );

    expect(planSpawning(snap)).not.toMatchObject([{ role: "miner" }]);
  });

  it("spawns one miner per source once containers exist", () => {
    const snap = empire(
      colony({
        // 2 sources -> bootstrap quota met
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10), sourceAt(30, 40)] }) },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10), sourceAt(30, 40)],
        containers: [containerAt(10, 10), containerAt(40, 40)]
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "miner",
        body: [WORK, WORK, MOVE], // container present -> no CARRY needed
        memory: { home: "W1N1", role: "miner" }
      }
    ]);
  });

  it("spawns a hauler once the miner quota is met and a container is filling", () => {
    const snap = empire(
      colony({
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)] }), miner: 1 },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10)],
        containers: [containerAt(10, 10, 500)]
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "hauler" }]);
  });

  it("spawns a builder once a construction backlog exists and higher-priority quotas are met", () => {
    const snap = empire(
      colony({
        // everything above builder satisfied
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)], controllerLevel: 4 }), upgrader: 4 },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources: [sourceAt(20, 10)],
        storageEnergy: 200_000,
        constructionProgress: 4_000
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "builder",
        body: [WORK, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "builder" }
      }
    ]);
  });

  it("fills the upgrader deficit before the builder one — builder is lowest priority", () => {
    const snap = empire(
      colony({
        // upgrader AND builder both under quota
        census: { bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)], controllerLevel: 4 }) },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources: [sourceAt(20, 10)],
        storageEnergy: 200_000,
        constructionProgress: 4_000
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ role: "upgrader" });
  });

  it("recovers a wiped colony with a supply creep when storage still holds energy", () => {
    // An established room that lost every creep still has stored energy, but
    // nothing alive to move it: energyAvailable only ever climbs to the spawn's
    // own regen. Supply is the role that withdraws from storage and refills the
    // extensions — a hauler would be useless here, it only moves energy the
    // other way (container -> storage) and would strand the colony.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10), sourceAt(30, 40)],
        storageEnergy: 50_000
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "supply" }]);
  });

  it("recovers a wiped colony with a bootstrap when there is no stored energy", () => {
    // Nothing to haul from, so recovery falls back to the one role that needs
    // no infrastructure at all: harvest a source, carry it to the spawn.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10)],
        storageEnergy: 0
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "bootstrap" }]);
  });

  it("treats a colony with any live creep as healthy, not wiped", () => {
    // Recovery must fire only on a true wipe. One live creep of any role means
    // something is still working the room, so the normal quota diff decides —
    // otherwise a single surviving creep would be joined by a supply creep the
    // colony never asked for, off the storage branch.
    const snap = empire(
      colony({
        census: { miner: 1 },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: [sourceAt(20, 10)],
        storageEnergy: 50_000
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "bootstrap" }]);
  });

  it("never emits a body the colony cannot pay for", () => {
    // Body calculators clamp their energy argument UP to a floor, so below that
    // floor they hand back a body costing more than the room has: bootstrapBody
    // returns [WORK,CARRY,MOVE] (200) however little energy it is given.
    // Without this guard the spawn dry run rejects it every tick forever.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 150,
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("still spawns a cheap role the colony can afford below the bootstrap floor", () => {
    // The affordability floor is per-role, not a flat 300: a hauler's cheapest
    // body is one CARRY,CARRY,MOVE set at 150, and desiredHaulerCount's own
    // MIN_HAULER_ENERGY documents 150 as sufficient. A blanket 300 floor would
    // strand a colony that can afford the hauler it actually needs.
    const snap = empire(
      colony({
        census: {
          bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)], energyCapacity: 150 }),
          miner: 1
        },
        spawns: [spawn()],
        // Capacity, not availability, is what sizes the body (issue #21) — a
        // 150-capacity room wants exactly one CARRY,CARRY,MOVE set, which it
        // can pay for. The point is that the floor is per-role: a blanket 300
        // would strand this colony from the hauler it actually needs.
        energyAvailable: 200,
        energyCapacity: 150,
        sources: [sourceAt(20, 10)],
        containers: [containerAt(10, 10, 500)]
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "hauler" }]);
  });

  it("scales the bootstrap body to available energy", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 550,
        energyCapacity: 550,
        sources: [sourceAt(20, 10)]
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ kind: "spawn", role: "bootstrap" });
    expect(intent.kind === "spawn" && intent.body.filter(p => p === WORK)).toHaveLength(2);
  });

  it("sizes normal-path bodies from capacity, so the same room always yields the same body", () => {
    // The defect (issue #21): sizing from energyAvailable made body size depend
    // on WHICH TICK the planner happened to run. A spawn firing just after the
    // room spent energy locked in a runt that then lived ~1500 ticks. Capacity
    // is the room's persistent, timing-independent budget.
    // 800 capacity sizes a 3-set [WORK,CARRY,MOVE,MOVE] body (750). Sized from
    // availability, a full room would instead yield only what that tick's
    // energy bought — the two are visibly different creeps.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 800,
        energyCapacity: 800,
        sources: [sourceAt(20, 10)]
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent.kind === "spawn" && intent.body.filter(p => p === WORK)).toHaveLength(3);
  });

  it("waits for a refill rather than spawning a runt sized to a drained room", () => {
    // The other half of issue #21: with sizing moved to capacity, a drained
    // room can no longer afford the body it wants, and the existing
    // affordability guard becomes the "wait until the room can pay" mechanism
    // for free. Previously this room would have locked in a 2-WORK runt that
    // then lived ~1500 ticks.
    const snap = empire(
      colony({
        // One live creep, so this is a healthy colony on the normal quota path
        // and not a wipe — recovery deliberately still sizes from availability.
        census: { bootstrap: 1 },
        spawns: [spawn()],
        energyAvailable: 400, // would have bought a 2-WORK runt
        energyCapacity: 800, // wants the 4-WORK, 800-cost body
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("sizes a recovery creep from available energy, not the capacity it cannot fill", () => {
    // The deliberate exception to capacity sizing (issue #21). A wiped colony
    // has nothing alive to fill its extensions, so energyAvailable only ever
    // climbs to the spawn's own ~300 regen. Sizing recovery from this room's
    // 1300 capacity would emit a body it can never pay for, the affordability
    // guard would reject it every tick, and the colony would stay dead forever.
    const snap = empire(
      colony({
        census: {}, // wiped — recovery path
        spawns: [spawn()],
        energyAvailable: 300,
        energyCapacity: 1300,
        sources: [sourceAt(20, 10)],
        storageEnergy: 0 // no stored energy -> recovery falls back to bootstrap
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ role: "bootstrap" });
    // The 300-regen body, not the 1300-capacity one the room cannot afford.
    expect(intent.kind === "spawn" && intent.body).toEqual([WORK, CARRY, MOVE, MOVE]);
  });
});

// --- bootstrap quota ----------------------------------------------------------
// Bootstrap is the colony's whole workforce before miners/haulers exist, so the
// quota is sized by harvest throughput, not by a flat per-source constant. Two
// sources yield 20 energy/tick (3000 per 300-tick regen each) and one WORK part
// harvests 2/tick, so 10 WORK drains them exactly — the quota must field enough
// creeps to cover that plus a margin of work-ticks left to spend the energy on
// building (gh #23).
describe("bootstrap quota", () => {
  it("fields enough WORK parts to drain every source with headroom to spend", () => {
    // From RCL2 the throughput target applies. At the 300 floor bootstrapBody
    // is [WORK,CARRY,MOVE] — 1 WORK each.
    const twoSources = colony({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });

    // 2 sources * 10 energy/tick / 2 per WORK = 10 WORK to saturate.
    expect(desiredBootstrapCount(twoSources)).toBeGreaterThanOrEqual(10);
  });

  it("scales down as bigger bodies carry more WORK each", () => {
    // At 800 capacity bootstrapBody carries 4 WORK, so far fewer creeps cover
    // the same throughput — the quota must not keep spawning a flat count.
    const small = colony({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });
    const large = colony({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 800, controllerLevel: 2 });

    expect(desiredBootstrapCount(large)).toBeLessThan(desiredBootstrapCount(small));
  });

  it("scales with the number of sources", () => {
    const one = colony({ sources: [sourceAt(10, 10)], energyCapacity: 300, controllerLevel: 2 });
    const two = colony({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(two)).toBeGreaterThan(desiredBootstrapCount(one));
  });

  // Before RCL2 there are no extensions to fill and no backlog worth a big
  // workforce — a swollen bootstrap count just delays the first upgrade that
  // reaches RCL2. Stay lean until RCL2, then ramp to the throughput target.
  it("stays lean before RCL2 so upgrading leads the early game", () => {
    const sources = [sourceAt(10, 10), sourceAt(40, 40)];
    const rcl1 = colony({ sources, energyCapacity: 300, controllerLevel: 1 });
    const rcl2 = colony({ sources, energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(rcl1)).toBeLessThan(desiredBootstrapCount(rcl2));
    expect(desiredBootstrapCount(rcl1)).toBeLessThanOrEqual(sources.length * 2);
  });
});
