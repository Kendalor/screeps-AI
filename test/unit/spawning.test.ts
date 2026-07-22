import { describe, expect, it } from "vitest";
import { desiredMinerCount } from "../../src/systems/logistics";
import { desiredBootstrapCount, planSpawning } from "../../src/systems/spawning";
import { colony } from "../../src/colony";
import { colonySnap, containerAt, sourceAt, spawn } from "../fixtures";

// Derives "quota already met" from the real quota (which depends on controllerLevel)
// rather than hardcoding a count, so callers must pass the same level their scenario uses.
function bootstrapMet(over: Parameters<typeof colony>[0] = {}): number {
  return desiredBootstrapCount(colonySnap(over));
}

// Same, for miner — tests about lower-priority roles need the miner deficit satisfied too,
// now that miner wants creeps from RCL1 rather than only once a container exists.
function minerMet(over: Parameters<typeof colony>[0] = {}): number {
  return desiredMinerCount(colonySnap(over));
}

describe("spawning planner", () => {
  it("spawns a bootstrap when the colony is below quota", () => {
    const snap = colony(
      colonySnap({
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

  // Damage consumes body parts in array order; a multi-set body is grouped per set
  // by the formula, so the emitted intent must re-sort it by priority.
  it("orders the spawned body so the most valuable parts are destroyed last", () => {
    const snap = colony(
      colonySnap({
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
    const rank = (p: BodyPartConstant) => [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE].indexOf(p);
    for (let i = 1; i < body.length; i++) {
      expect(rank(body[i])).toBeGreaterThanOrEqual(rank(body[i - 1]));
    }
  });

  it("emits nothing when the census already meets quota", () => {
    // One hauler alive lifts the cold-start floor, so the miner quota is met by whatever
    // desiredMinerCount actually wants at this hauler count rather than a hardcoded 1.
    const sources = [sourceAt(20, 10)];
    const census = { hauler: 1 };
    const snap = colony(
      colonySnap({
        census: {
          bootstrap: bootstrapMet({ sources }),
          miner: minerMet({ sources, census }),
          ...census
        },
        spawns: [spawn()],
        sources
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("does not spawn from a busy spawn", () => {
    const snap = colony(
      colonySnap({
        census: {},
        spawns: [spawn("spawn1", true)],
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("spawns an upgrader once storage exists and higher-priority quotas are met", () => {
    const sources = [sourceAt(20, 10)];
    const census = { hauler: 1 };
    const snap = colony(
      colonySnap({
        census: {
          bootstrap: bootstrapMet({ sources, controllerLevel: 4 }),
          miner: minerMet({ sources, census }),
          ...census
        },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        storageEnergy: 200_000,
        sources
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

  it("spawns a miner from RCL1 with no container, once the bootstrap quota is met", () => {
    const sources = [sourceAt(20, 10), sourceAt(30, 40)];
    const snap = colony(
      colonySnap({
        census: { bootstrap: bootstrapMet({ sources }) },
        spawns: [spawn()],
        energyAvailable: 300,
        sources,
        containers: []
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ role: "miner" }]);
  });

  it("spawns one miner per source once containers exist", () => {
    const snap = colony(
      colonySnap({
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
        body: [WORK, WORK, MOVE],
        memory: { home: "W1N1", role: "miner" }
      }
    ]);
  });

  it("spawns a hauler once the miner quota is met and a container is filling", () => {
    const snap = colony(
      colonySnap({
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
    const sources = [sourceAt(20, 10)];
    const census = { hauler: 1 };
    const snap = colony(
      colonySnap({
        census: {
          bootstrap: bootstrapMet({ sources, controllerLevel: 4 }),
          miner: minerMet({ sources, census }),
          upgrader: 4,
          ...census
        },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources,
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
    const sources = [sourceAt(20, 10)];
    const census = { hauler: 1 };
    const snap = colony(
      colonySnap({
        census: {
          bootstrap: bootstrapMet({ sources, controllerLevel: 4 }),
          miner: minerMet({ sources, census }),
          ...census
        },
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources,
        storageEnergy: 200_000,
        constructionProgress: 4_000
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ role: "upgrader" });
  });

  it("recovers a wiped colony with a supply creep when storage still holds energy", () => {
    // A hauler moves energy the other way (container -> storage) and would be
    // useless here; supply withdraws from storage to refill extensions.
    const snap = colony(
      colonySnap({
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
    const snap = colony(
      colonySnap({
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
    // Recovery must fire only on a true wipe; any live creep means the normal
    // quota diff should decide instead.
    const snap = colony(
      colonySnap({
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
    // Body calculators clamp their energy argument up to a floor, so below that
    // floor they can hand back a body costing more than the room has.
    const snap = colony(
      colonySnap({
        census: {},
        spawns: [spawn()],
        energyAvailable: 150,
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("still spawns a cheap role the colony can afford below the bootstrap floor", () => {
    // The affordability floor is per-role, not a flat 300: a hauler's cheapest body
    // is one CARRY,CARRY,MOVE set at 150.
    const snap = colony(
      colonySnap({
        census: {
          bootstrap: bootstrapMet({ sources: [sourceAt(20, 10)], energyCapacity: 150 }),
          miner: 1
        },
        spawns: [spawn()],
        energyAvailable: 200,
        energyCapacity: 150,
        sources: [sourceAt(20, 10)],
        containers: [containerAt(10, 10, 500)]
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "hauler" }]);
  });

  it("scales the bootstrap body to available energy", () => {
    const snap = colony(
      colonySnap({
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
    // Sizing from energyAvailable instead would make body size depend on which
    // tick the planner ran; capacity is the room's persistent, timing-independent budget.
    const snap = colony(
      colonySnap({
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
    // With sizing moved to capacity, a drained room can no longer afford the body
    // it wants; the existing affordability guard becomes "wait until it can pay".
    const snap = colony(
      colonySnap({
        // One live creep: healthy colony on the normal quota path, not a wipe.
        census: { bootstrap: 1 },
        spawns: [spawn()],
        energyAvailable: 400,
        energyCapacity: 800,
        sources: [sourceAt(20, 10)]
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("sizes a recovery creep from available energy, not the capacity it cannot fill", () => {
    // Deliberate exception to capacity sizing: a wiped colony has nothing alive to
    // fill its extensions, so energyAvailable never exceeds the spawn's own regen.
    const snap = colony(
      colonySnap({
        census: {},
        spawns: [spawn()],
        energyAvailable: 300,
        energyCapacity: 1300,
        sources: [sourceAt(20, 10)],
        storageEnergy: 0
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ role: "bootstrap" });
    expect(intent.kind === "spawn" && intent.body).toEqual([WORK, CARRY, MOVE, MOVE]);
  });
});

// Bootstrap is sized by harvest throughput, not a flat per-source constant: two
// sources yield 20 energy/tick and one WORK harvests 2/tick, so 10 WORK saturates them.
describe("bootstrap quota", () => {
  it("fields enough WORK parts to drain every source with headroom to spend", () => {
    const twoSources = colonySnap({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(twoSources)).toBeGreaterThanOrEqual(10);
  });

  it("scales down as bigger bodies carry more WORK each", () => {
    const small = colonySnap({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });
    const large = colonySnap({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 800, controllerLevel: 2 });

    expect(desiredBootstrapCount(large)).toBeLessThan(desiredBootstrapCount(small));
  });

  it("scales with the number of sources", () => {
    const one = colonySnap({ sources: [sourceAt(10, 10)], energyCapacity: 300, controllerLevel: 2 });
    const two = colonySnap({ sources: [sourceAt(10, 10), sourceAt(40, 40)], energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(two)).toBeGreaterThan(desiredBootstrapCount(one));
  });

  // Before RCL2 there are no extensions to fill; a swollen bootstrap count would
  // just delay the first upgrade to RCL2.
  it("stays lean before RCL2 so upgrading leads the early game", () => {
    const sources = [sourceAt(10, 10), sourceAt(40, 40)];
    const rcl1 = colonySnap({ sources, energyCapacity: 300, controllerLevel: 1 });
    const rcl2 = colonySnap({ sources, energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(rcl1)).toBeLessThan(desiredBootstrapCount(rcl2));
    expect(desiredBootstrapCount(rcl1)).toBeLessThanOrEqual(sources.length * 2);
  });
});
