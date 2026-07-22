import { describe, expect, it } from "vitest";
import { bodyCost } from "../../src/behaviors/body";
import type { Intent } from "../../src/intents/types";
import { RECOVERY_PRIORITY, type CreepRequest } from "../../src/spawn/request";
import { bootstrapRequests, desiredBootstrapCount, planSpawning, recoveryRequests } from "../../src/systems/spawning";
import { colonySnap, containerAt, snapCreep, snapCreeps, sourceAt, spawn, testColony } from "../fixtures";

// planSpawning is a pure arbiter: it never names a role and never compares counts, so its tests
// drive it through the requesters that stand behind it rather than through hand-built request lists.
describe("spawn arbiter", () => {
  it("emits a spawn intent for the highest-priority request", () => {
    const colony = testColony({ spawns: [spawn()], energyAvailable: 300, sources: [sourceAt(20, 10)] });

    expect(planSpawning(colony)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        body: [WORK, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "bootstrap", op: "recovery:W1N1" }
      }
    ]);
  });

  it("emits nothing when every requester is satisfied", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const colony = testColony({
      spawns: [spawn()],
      sources: [source],
      creeps: [
        ...snapCreeps("bootstrap", desiredBootstrapCount(colonySnap({ sources: [source] }))),
        ...snapCreeps("hauler", 1),
        snapCreep("miner", { memory: { sourceId: source.id } })
      ]
    });

    expect(planSpawning(colony)).toEqual([]);
  });

  it("does not spawn from a busy spawn", () => {
    const colony = testColony({ spawns: [spawn("spawn1", true)], sources: [sourceAt(20, 10)] });

    expect(planSpawning(colony)).toEqual([]);
  });

  // The trap this replaces: "for each spawn, find the best request" hands the same top-priority
  // request to every idle spawn, spawning it N times in one tick.
  it("consumes a request at most once per tick", () => {
    // Storage but no sources: recovery wants exactly one supply creep and nothing else does.
    const colony = testColony({
      spawns: [spawn("spawn1"), spawn("spawn2")],
      sources: [],
      energyAvailable: 1000,
      energyCapacity: 1000,
      storageEnergy: 50_000
    });

    expect(planSpawning(colony)).toHaveLength(1);
  });

  it("gives N idle spawns N distinct requests, in priority order", () => {
    const colony = testColony({
      spawns: [spawn("spawn1"), spawn("spawn2")],
      sources: [sourceAt(20, 10)],
      energyAvailable: 2000,
      energyCapacity: 300
    });

    const intents = planSpawning(colony);
    expect(intents).toHaveLength(2);
    expect(intents.map(i => i.kind === "spawn" && i.spawn)).toEqual(["spawn1", "spawn2"]);
    // Recovery outranks the ordinary bootstrap request, and the two are different requests.
    expect(intents.map(i => i.kind === "spawn" && i.memory.op)).toEqual(["recovery:W1N1", "bootstrap:W1N1"]);
  });

  // energyAvailable is one shared room pool: two spawns each emitting an affordable body in a room
  // that can only pay for one produces a silent ERR_NOT_ENOUGH_ENERGY without a running budget.
  it("deducts each spawn from a running energy budget", () => {
    const colony = testColony({
      spawns: [spawn("spawn1"), spawn("spawn2")],
      sources: [sourceAt(20, 10)],
      energyAvailable: 300,
      energyCapacity: 300
    });

    const intents = planSpawning(colony);
    expect(intents).toHaveLength(1);
    expect(bodyCost((intents[0] as Extract<Intent, { kind: "spawn" }>).body)).toBeLessThanOrEqual(300);
  });

  it("waits for a refill rather than spawning a runt sized to a drained room", () => {
    const colony = testColony({
      // One live creep: an ordinary tick on the normal path, not a wipe.
      creeps: snapCreeps("bootstrap", 1),
      spawns: [spawn()],
      energyAvailable: 400,
      energyCapacity: 800,
      sources: [sourceAt(20, 10)]
    });

    expect(planSpawning(colony)).toEqual([]);
  });

  // Filling with affordable creeps first would consume the colony's energy on cheap ones forever,
  // so the expensive high-priority request never becomes affordable. A livelock, not an inversion.
  it("stops on an unaffordable request instead of skipping to a cheaper one", () => {
    const colony = testColony({
      // Bootstrap is short and expensive at this capacity; the hauler request behind it is cheap.
      creeps: [...snapCreeps("bootstrap", 1), ...snapCreeps("miner", 1)],
      spawns: [spawn()],
      energyAvailable: 200,
      energyCapacity: 800,
      controllerLevel: 2,
      sources: [sourceAt(20, 10)],
      containers: [containerAt(10, 10, 500)]
    });

    expect(planSpawning(colony)).toEqual([]);
  });
});

describe("recoveryRequests", () => {
  it("outranks every ordinary request", () => {
    const [request] = recoveryRequests(testColony({ sources: [sourceAt(20, 10)] }));
    const ordinary = bootstrapRequests(testColony({ sources: [sourceAt(20, 10)] }));

    expect(request.priority).toBe(RECOVERY_PRIORITY);
    for (const r of ordinary) expect(r.priority).toBeLessThan(RECOVERY_PRIORITY);
  });

  // A hauler moves energy the other way (container -> storage) and would be useless here;
  // supply withdraws from storage to refill extensions.
  it("restarts a wiped colony with a supply creep when storage still holds energy", () => {
    const colony = testColony({
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      energyAvailable: 300,
      storageEnergy: 50_000
    });

    expect(recoveryRequests(colony)[0].memory.role).toBe("supply");
  });

  it("restarts a wiped colony with a bootstrap when there is no stored energy", () => {
    const colony = testColony({ sources: [sourceAt(20, 10)], energyAvailable: 300, storageEnergy: 0 });

    expect(recoveryRequests(colony)[0].memory.role).toBe("bootstrap");
  });

  it("asks for nothing when a colony with neither storage nor sources cannot be restarted", () => {
    expect(recoveryRequests(testColony({ sources: [], storageEnergy: 0 }))).toEqual([]);
  });

  // The infinite-spawn guard: recovery is the one requester whose satisfaction check is "is
  // anything alive at all", so an inverted check would spawn every tick forever.
  it("asks for nothing while any creep is alive", () => {
    const colony = testColony({
      creeps: snapCreeps("miner", 1),
      sources: [sourceAt(20, 10)],
      storageEnergy: 50_000
    });

    expect(recoveryRequests(colony)).toEqual([]);
  });

  // Sizing against available energy is not the same as being affordable: every body formula clamps
  // to at least one whole set, so below that floor it hands back a body the room cannot pay for.
  // At RECOVERY_PRIORITY such a request sorts first and would trip the arbiter's stop, blocking
  // every other request behind it.
  it("withholds its request when even the smallest body is unaffordable", () => {
    const colony = testColony({
      spawns: [spawn()],
      energyAvailable: 100, // below the 250 a bootstrap's smallest body costs
      energyCapacity: 300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    expect(recoveryRequests(colony)).toEqual([]);
    expect(planSpawning(colony)).toEqual([]);
  });

  it("does not block a lower-priority request it cannot afford", () => {
    const colony = testColony({
      // No creeps alive, so recovery is in play; storage funds a supply body costing 150.
      spawns: [spawn()],
      energyAvailable: 100,
      energyCapacity: 300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 50_000
    });

    // Unaffordable at 100, so it stands aside rather than stopping the arbiter on request zero.
    expect(recoveryRequests(colony)).toEqual([]);
  });

  // Deliberate exception to capacity sizing: a wiped colony has nothing alive to fill its
  // extensions, so energyAvailable never exceeds the spawn's own regen and a capacity-sized body
  // would fail the affordability guard forever.
  it("sizes its body against available energy, not the capacity it cannot fill", () => {
    const colony = testColony({
      spawns: [spawn()],
      energyAvailable: 300,
      energyCapacity: 1300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    const [request] = recoveryRequests(colony);
    expect(request.body).toEqual([WORK, CARRY, MOVE, MOVE]);
    // Affordable by construction, so it can never trigger the arbiter's stop.
    expect(bodyCost(request.body)).toBeLessThanOrEqual(300);
  });
});

describe("bootstrapRequests", () => {
  // Each request owns its body and memory: sharing one array across every request a call produces
  // means anything that later resizes a body in place silently corrupts its siblings.
  it("gives every request its own body and memory", () => {
    const sources = [sourceAt(20, 10)];
    const requests = bootstrapRequests(testColony({ sources }));

    expect(requests.length).toBeGreaterThan(1);
    expect(requests[0].body).not.toBe(requests[1].body);
    expect(requests[0].memory).not.toBe(requests[1].memory);
    expect(requests[0].body).toEqual(requests[1].body);
  });

  it("asks for nothing once the live bootstraps meet the quota", () => {
    const sources = [sourceAt(20, 10)];
    const met = desiredBootstrapCount(colonySnap({ sources }));
    const colony = testColony({ sources, creeps: snapCreeps("bootstrap", met) });

    expect(bootstrapRequests(colony)).toEqual([]);
  });

  it("asks only for the shortfall", () => {
    const sources = [sourceAt(20, 10)];
    const met = desiredBootstrapCount(colonySnap({ sources }));
    const colony = testColony({ sources, creeps: snapCreeps("bootstrap", met - 1) });

    expect(bootstrapRequests(colony)).toHaveLength(1);
  });

  // Damage consumes body parts in array order; a multi-set body is grouped per set by the formula,
  // so the request must carry it re-sorted by survival priority.
  it("orders the body so the most valuable parts are destroyed last", () => {
    const colony = testColony({ energyCapacity: 750, sources: [sourceAt(20, 10)] });

    const body = bootstrapRequests(colony)[0].body;
    expect(body).toEqual([WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]);
    const rank = (p: BodyPartConstant) => [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE].indexOf(p);
    for (let i = 1; i < body.length; i++) {
      expect(rank(body[i])).toBeGreaterThanOrEqual(rank(body[i - 1]));
    }
  });

  // Sizing from energyAvailable instead would make body size depend on which tick the planner ran;
  // capacity is the room's persistent, timing-independent budget.
  it("sizes its body from capacity, so the same room always yields the same body", () => {
    const workParts = (requests: CreepRequest[]) => requests[0].body.filter(p => p === WORK).length;

    expect(workParts(bootstrapRequests(testColony({ energyAvailable: 550, energyCapacity: 550 })))).toBe(2);
    expect(workParts(bootstrapRequests(testColony({ energyAvailable: 300, energyCapacity: 800 })))).toBe(3);
  });
});

// The round trip that gives a requester identity over its creeps: the memory it writes comes back
// to it next tick as SnapCreep.memory, and its satisfaction check reads it there. Nothing else
// binds a creep to the requester that ordered it.
describe("request memory round trip", () => {
  it("feeds a spawned request's memory back into the satisfaction check that emitted it", () => {
    const sources = [sourceAt(20, 10)];
    const before = testColony({ spawns: [spawn()], sources, creeps: snapCreeps("bootstrap", 1) });

    const [intent] = planSpawning(before);
    const spawned = (intent as Extract<Intent, { kind: "spawn" }>).memory;

    // execute.ts puts that memory on the creep; next tick the snapshot exposes it verbatim.
    const after = testColony({
      spawns: [spawn()],
      sources,
      creeps: [...snapCreeps("bootstrap", 1), snapCreep(spawned.role, { spawning: true, memory: spawned })]
    });

    const requestsAfter = bootstrapRequests(after);
    expect(bootstrapRequests(before)).toHaveLength(requestsAfter.length + 1);
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
