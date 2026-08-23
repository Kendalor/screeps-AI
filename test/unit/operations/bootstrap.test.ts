// The Bootstrap operation covers two recoveries: a total creep wipe on an established colony (still has
// its spawn — a single supply/bootstrap creep restarts it), and any owned room with zero spawns at all
// (a wiped colony that lost its spawn, or a freshly claimed Colonize target that never had one — both
// look identical from here, so both get the same settler workforce). See operations/bootstrap.ts's header.

import { describe, expect, it } from "vitest";
import { bodyCost } from "../../../src/spawn/body";
import { Bootstrap } from "../../../src/operations/bootstrap";
import { RECOVERY_PRIORITY } from "../../../src/spawn/request";
import type { ColonySnapshot } from "../../../src/snapshot/types";
import { colonySnap, snapCreeps, sourceAt } from "../../fixtures";

// Recovery is the only thing Bootstrap emits now; it carries the "recovery:<room>" op stamp.
const bootstrap = new Bootstrap("W1N1");
const recovery = (snap: ColonySnapshot) => bootstrap.desiredCreeps(snap).filter(r => r.priority === RECOVERY_PRIORITY);

// A colony that still has its own spawn — the "wiped but spawn intact" recovery path below is only
// reachable once noSpawnRequests' own gate (colony.spawns.length === 0) is closed.
const HAS_SPAWN = { spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] };

describe("Recovery (via Bootstrap): wiped colony, spawn intact", () => {
  it("outranks every ordinary request", () => {
    const snap = colonySnap({ ...HAS_SPAWN, sources: [sourceAt(20, 10)] });
    const requests = bootstrap.desiredCreeps(snap);
    const recoveryReqs = requests.filter(r => r.priority === RECOVERY_PRIORITY);
    const ordinary = requests.filter(r => r.priority !== RECOVERY_PRIORITY);

    expect(recoveryReqs.length).toBeGreaterThan(0);
    for (const r of ordinary) expect(r.priority).toBeLessThan(RECOVERY_PRIORITY);
  });

  // A hauler moves energy the other way (container -> storage) and would be useless here;
  // supply withdraws from storage to refill extensions.
  it("restarts a wiped colony with a supply creep when storage still holds energy", () => {
    const snap = colonySnap({
      ...HAS_SPAWN,
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      energyAvailable: 300,
      storageEnergy: 50_000
    });

    expect(recovery(snap)[0].memory.role).toBe("supply");
  });

  it("restarts a wiped colony with a bootstrap when there is no stored energy", () => {
    const snap = colonySnap({ ...HAS_SPAWN, sources: [sourceAt(20, 10)], energyAvailable: 300, storageEnergy: 0 });

    expect(recovery(snap)[0].memory.role).toBe("bootstrap");
  });

  it("asks for nothing when a colony with neither storage nor sources cannot be restarted", () => {
    const snap = colonySnap({ ...HAS_SPAWN, sources: [], storageEnergy: 0 });

    expect(bootstrap.desiredCreeps(snap)).toEqual([]);
  });

  // The infinite-spawn guard: recovery is the one requester whose satisfaction check is "is
  // anything alive at all", so an inverted check would spawn every tick forever.
  it("emits no recovery while any creep is alive", () => {
    const snap = colonySnap({
      ...HAS_SPAWN,
      creeps: snapCreeps("miner", 1),
      sources: [sourceAt(20, 10)],
      storageEnergy: 50_000
    });

    expect(recovery(snap)).toEqual([]);
  });

  // Sizing against available energy is not the same as being affordable: every body formula clamps
  // to at least one whole set, so below that floor it hands back a body the room cannot pay for.
  it("withholds recovery when even the smallest body is unaffordable", () => {
    const snap = colonySnap({
      ...HAS_SPAWN,
      energyAvailable: 100, // below the 250 a bootstrap's smallest body costs
      energyCapacity: 300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    expect(recovery(snap)).toEqual([]);
  });

  // Deliberate exception to capacity sizing: a wiped colony has nothing alive to fill its
  // extensions, so energyAvailable never exceeds the spawn's own regen and a capacity-sized body
  // would fail the affordability guard forever.
  it("sizes its body against available energy, not the capacity it cannot fill", () => {
    const snap = colonySnap({
      ...HAS_SPAWN,
      energyAvailable: 300,
      energyCapacity: 1300,
      sources: [sourceAt(20, 10)],
      storageEnergy: 0
    });

    const req = recovery(snap)[0];
    expect(req?.body).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(bodyCost(req?.body ?? [])).toBeLessThanOrEqual(300);
  });

  it("targets its own room", () => {
    const snap = colonySnap({ ...HAS_SPAWN, sources: [sourceAt(20, 10)] });

    expect(recovery(snap)[0]?.targetRoom).toBe("W1N1");
  });
});

// A colony with zero spawns — whether it's a wiped established colony or a freshly claimed Colonize
// target — gets up to 4 settlers instead: settler walks home (targetRoom/moveToRoom) and prioritizes
// building the spawn construction site above everything else, which neither supply (logistics-pool
// dispatch, plans against creep.room not targetRoom) nor a single bootstrap creep can do.
describe("Recovery (via Bootstrap): no spawn at all", () => {
  const MAX_SETTLERS = 4;

  it("requests settlers, not supply, even though storage holds energy", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], energyCapacity: 1300, storageEnergy: 50_000 });

    const requests = bootstrap.desiredCreeps(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.memory.role).toBe("settler");
  });

  it("requests up to MAX_SETTLERS at once", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], energyCapacity: 1300 });

    expect(bootstrap.desiredCreeps(snap)).toHaveLength(MAX_SETTLERS);
  });

  it("tops up to MAX_SETTLERS when some are already owned", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      energyCapacity: 1300,
      creeps: snapCreeps("settler", 2, { home: "W1N1" })
    });

    expect(bootstrap.desiredCreeps(snap)).toHaveLength(MAX_SETTLERS - 2);
  });

  it("stops requesting once MAX_SETTLERS are already owned", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      energyCapacity: 1300,
      creeps: snapCreeps("settler", MAX_SETTLERS, { home: "W1N1" })
    });

    expect(bootstrap.desiredCreeps(snap)).toEqual([]);
  });

  it("does not count a settler that belongs to a different home colony", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      energyCapacity: 1300,
      creeps: snapCreeps("settler", MAX_SETTLERS, { home: "W9N9" })
    });

    expect(bootstrap.desiredCreeps(snap)).toHaveLength(MAX_SETTLERS);
  });

  it("still requests settlers even with other creeps alive (miners, haulers) as long as no spawn exists", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      energyCapacity: 1300,
      creeps: snapCreeps("miner", 3, { home: "W1N1" })
    });

    const requests = bootstrap.desiredCreeps(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.memory.role).toBe("settler");
  });

  it("carries no spawnRoom pin, so the cross-colony arbiter fallback can serve it", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], energyCapacity: 1300 });

    for (const r of bootstrap.desiredCreeps(snap)) expect(r.spawnRoom).toBeUndefined();
  });

  it("withholds when even the smallest settler body is unaffordable", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], energyAvailable: 100, energyCapacity: 100 });

    expect(bootstrap.desiredCreeps(snap)).toEqual([]);
  });
});

// The early-game workforce is gone: a fresh colony with creeps still alive gets no "bootstrap" role
// spawned. Only a total wipe (no creeps) brings the bootstrap body back, and that is recovery, above.
describe("no early-game workforce", () => {
  // A source and a live creep (so recovery stays silent): the old workforce would ask for several
  // bootstraps here; the new operation asks for none.
  it("spawns no bootstrap workforce while the colony is running", () => {
    const snap = colonySnap({
      ...HAS_SPAWN,
      sources: [sourceAt(10, 10), sourceAt(40, 40)],
      energyCapacity: 300,
      controllerLevel: 2,
      creeps: snapCreeps("miner", 1)
    });

    expect(bootstrap.desiredCreeps(snap)).toEqual([]);
  });

  // Not even at room start — a colony with only its spawn (no creeps yet) reaches recovery, which
  // asks for a single restart creep, never a workforce. The economy roles (miner/hauler/…) lead now.
  it("emits exactly one recovery creep at a fresh room start, not a workforce", () => {
    const snap = colonySnap({ ...HAS_SPAWN, sources: [sourceAt(20, 10)], energyAvailable: 300, controllerLevel: 1 });

    const requests = bootstrap.desiredCreeps(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].priority).toBe(RECOVERY_PRIORITY);
  });
});
