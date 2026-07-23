// The colony-scoped requesters that no operation owns yet: recovery, bootstrap, builder. Ported from
// systems/spawning.test.ts and systems/building.test.ts — the quota formulas did not change, only
// their home and their argument (a ColonySnapshot now, not a Colony wrapper). Arbiter behaviour
// (routing, budget, livelock) lives in test/unit/empire/spawning.test.ts.

import { describe, expect, it } from "vitest";
import { bodyCost } from "../../../src/behaviors/body";
import {
  bootstrapRequests,
  builderRequests,
  desiredBootstrapCount,
  recoveryRequests
} from "../../../src/colony/requests";
import { RECOVERY_PRIORITY, type CreepRequest } from "../../../src/spawn/request";
import { colonySnap, snapCreep, snapCreeps, sourceAt } from "../../fixtures";

describe("recoveryRequests", () => {
  it("outranks every ordinary request", () => {
    const [request] = recoveryRequests(colonySnap({ sources: [sourceAt(20, 10)] }));
    const ordinary = bootstrapRequests(colonySnap({ sources: [sourceAt(20, 10)] }));

    expect(request.priority).toBe(RECOVERY_PRIORITY);
    for (const r of ordinary) expect(r.priority).toBeLessThan(RECOVERY_PRIORITY);
  });

  // A hauler moves energy the other way (container -> storage) and would be useless here;
  // supply withdraws from storage to refill extensions.
  it("restarts a wiped colony with a supply creep when storage still holds energy", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      energyAvailable: 300,
      storageEnergy: 50_000
    });

    expect(recoveryRequests(snap)[0].memory.role).toBe("supply");
  });

  it("restarts a wiped colony with a bootstrap when there is no stored energy", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], energyAvailable: 300, storageEnergy: 0 });

    expect(recoveryRequests(snap)[0].memory.role).toBe("bootstrap");
  });

  it("asks for nothing when a colony with neither storage nor sources cannot be restarted", () => {
    expect(recoveryRequests(colonySnap({ sources: [], storageEnergy: 0 }))).toEqual([]);
  });

  // The infinite-spawn guard: recovery is the one requester whose satisfaction check is "is
  // anything alive at all", so an inverted check would spawn every tick forever.
  it("asks for nothing while any creep is alive", () => {
    const snap = colonySnap({
      creeps: snapCreeps("miner", 1),
      sources: [sourceAt(20, 10)],
      storageEnergy: 50_000
    });

    expect(recoveryRequests(snap)).toEqual([]);
  });

  // Sizing against available energy is not the same as being affordable: every body formula clamps
  // to at least one whole set, so below that floor it hands back a body the room cannot pay for.
  it("withholds its request when even the smallest body is unaffordable", () => {
    const snap = colonySnap({
      energyAvailable: 100, // below the 250 a bootstrap's smallest body costs
      energyCapacity: 300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    expect(recoveryRequests(snap)).toEqual([]);
  });

  // Deliberate exception to capacity sizing: a wiped colony has nothing alive to fill its
  // extensions, so energyAvailable never exceeds the spawn's own regen and a capacity-sized body
  // would fail the affordability guard forever.
  it("sizes its body against available energy, not the capacity it cannot fill", () => {
    const snap = colonySnap({
      energyAvailable: 300,
      energyCapacity: 1300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    const [request] = recoveryRequests(snap);
    expect(request.body).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(bodyCost(request.body)).toBeLessThanOrEqual(300);
  });

  it("targets its own room", () => {
    const [request] = recoveryRequests(colonySnap({ sources: [sourceAt(20, 10)] }));
    expect(request.targetRoom).toBe("W1N1");
  });
});

describe("bootstrapRequests", () => {
  // Each request owns its body and memory: sharing one array across every request a call produces
  // means anything that later resizes a body in place silently corrupts its siblings.
  it("gives every request its own body and memory", () => {
    const requests = bootstrapRequests(colonySnap({ sources: [sourceAt(20, 10)] }));

    expect(requests.length).toBeGreaterThan(1);
    expect(requests[0].body).not.toBe(requests[1].body);
    expect(requests[0].memory).not.toBe(requests[1].memory);
    expect(requests[0].body).toEqual(requests[1].body);
  });

  it("asks for nothing once the live bootstraps meet the quota", () => {
    const sources = [sourceAt(20, 10)];
    const met = desiredBootstrapCount(colonySnap({ sources }));
    const snap = colonySnap({ sources, creeps: snapCreeps("bootstrap", met) });

    expect(bootstrapRequests(snap)).toEqual([]);
  });

  it("asks only for the shortfall", () => {
    const sources = [sourceAt(20, 10)];
    const met = desiredBootstrapCount(colonySnap({ sources }));
    const snap = colonySnap({ sources, creeps: snapCreeps("bootstrap", met - 1) });

    expect(bootstrapRequests(snap)).toHaveLength(1);
  });

  // Damage consumes body parts in array order; a multi-set body is grouped per set by the formula,
  // so the request must carry it re-sorted by survival priority.
  it("orders the body so the most valuable parts are destroyed last", () => {
    const snap = colonySnap({ energyCapacity: 750, sources: [sourceAt(20, 10)] });

    const body = bootstrapRequests(snap)[0].body;
    expect(body).toEqual([WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]);
    const rank = (p: BodyPartConstant) => [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE].indexOf(p);
    for (let i = 1; i < body.length; i++) {
      expect(rank(body[i])).toBeGreaterThanOrEqual(rank(body[i - 1]));
    }
  });

  it("sizes its body from capacity, so the same room always yields the same body", () => {
    const workParts = (requests: CreepRequest[]) => requests[0].body.filter(p => p === WORK).length;

    expect(workParts(bootstrapRequests(colonySnap({ energyAvailable: 550, energyCapacity: 550 })))).toBe(2);
    expect(workParts(bootstrapRequests(colonySnap({ energyAvailable: 300, energyCapacity: 800 })))).toBe(3);
  });
});

// The round trip that gives a requester identity over its creeps: the memory it writes comes back to
// it next tick as SnapCreep.memory, and its satisfaction check reads it there.
describe("request memory round trip", () => {
  it("feeds a spawned request's memory back into the satisfaction check that emitted it", () => {
    const sources = [sourceAt(20, 10)];
    const before = colonySnap({ sources, creeps: snapCreeps("bootstrap", 1) });

    const [request] = bootstrapRequests(before);

    // execute.ts puts that memory on the creep; next tick the snapshot exposes it verbatim.
    const after = colonySnap({
      sources,
      creeps: [...snapCreeps("bootstrap", 1), snapCreep(request.memory.role, { spawning: true, memory: request.memory })]
    });

    expect(bootstrapRequests(before)).toHaveLength(bootstrapRequests(after).length + 1);
  });
});

// Bootstrap is sized by harvest throughput, not a flat per-source constant: two
// sources yield 20 energy/tick and one WORK harvests 2/tick, so 10 WORK saturates them.
describe("bootstrap quota", () => {
  it("fields enough WORK parts to drain every source with headroom to spend", () => {
    const twoSources = colonySnap({
      sources: [sourceAt(10, 10), sourceAt(40, 40)],
      energyCapacity: 300,
      controllerLevel: 2
    });

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

  it("stays lean before RCL2 so upgrading leads the early game", () => {
    const sources = [sourceAt(10, 10), sourceAt(40, 40)];
    const rcl1 = colonySnap({ sources, energyCapacity: 300, controllerLevel: 1 });
    const rcl2 = colonySnap({ sources, energyCapacity: 300, controllerLevel: 2 });

    expect(desiredBootstrapCount(rcl1)).toBeLessThan(desiredBootstrapCount(rcl2));
    expect(desiredBootstrapCount(rcl1)).toBeLessThanOrEqual(sources.length * 2);
  });
});

describe("builderRequests", () => {
  it("asks for nothing without construction backlog", () => {
    expect(builderRequests(colonySnap({ constructionProgress: 0, storageEnergy: 200_000 }))).toEqual([]);
  });

  it("scales one builder per 5k of outstanding work, capped at four", () => {
    expect(builderRequests(colonySnap({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toHaveLength(1);
    expect(builderRequests(colonySnap({ constructionProgress: 8_000, storageEnergy: 200_000 }))).toHaveLength(2);
    expect(builderRequests(colonySnap({ constructionProgress: 500_000, storageEnergy: 2_000_000 }))).toHaveLength(4);
  });

  it("holds until storage clears the reserve plus outstanding site cost", () => {
    expect(builderRequests(colonySnap({ constructionProgress: 10_000, storageEnergy: 55_000 }))).toHaveLength(0);
    expect(builderRequests(colonySnap({ constructionProgress: 10_000, storageEnergy: 65_000 }))).toHaveLength(2);
  });

  it("stays out of pre-storage building, which bootstrap already covers", () => {
    expect(builderRequests(colonySnap({ constructionProgress: 20_000, storageEnergy: 0, controllerLevel: 3 }))).toEqual(
      []
    );
  });

  it("returns nothing once the live builders meet the quota", () => {
    const snap = colonySnap({ constructionProgress: 8_000, storageEnergy: 200_000, creeps: snapCreeps("builder", 2) });

    expect(builderRequests(snap)).toEqual([]);
  });
});
