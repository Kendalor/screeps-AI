// Pure fixture tests, no Game mocking — a hand-built ColonySnapshot in, Provider[]/Consumer[] out.

import { describe, expect, it } from "vitest";
import { consumers, providers } from "../../../src/logistics/graph";
import { colonySnap, containerAt, dropAt, remoteEnergyAt, sinkAt, snapCreep, tombstoneAt, towerAt } from "../../fixtures";

describe("providers", () => {
  it("treats a source container holding energy as a provider", () => {
    const container = containerAt(10, 10, 300);
    const result = providers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));

    expect(result).toEqual([
      { ref: { kind: "structure", id: container.id }, resource: RESOURCE_ENERGY, available: 300, urgency: 0.15 }
    ]);
  });

  it("excludes an empty source container", () => {
    const container = containerAt(10, 10, 0);
    expect(providers(colonySnap({ containers: [container] }))).toEqual([]);
  });

  it("excludes the controller container from providers even when it holds energy", () => {
    // Within range 2 of the controller at (25,25).
    const container = containerAt(25, 27, 1000);
    expect(providers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }))).toEqual([]);
  });

  it("includes a dropped pile above the worthwhile floor", () => {
    const drop = dropAt(15, 15, 100);
    const result = providers(colonySnap({ drops: [drop] }));

    expect(result).toEqual([{ ref: { kind: "dropped", id: drop.id }, resource: RESOURCE_ENERGY, available: 100, urgency: 1 }]);
  });

  it("excludes a dropped pile below the worthwhile floor", () => {
    const drop = dropAt(15, 15, 10);
    expect(providers(colonySnap({ drops: [drop] }))).toEqual([]);
  });

  it("includes remote energy as an extra provider (the return-haul source)", () => {
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const result = providers(colonySnap({ remoteEnergy: [remote] }));

    expect(result).toContainEqual(
      expect.objectContaining({ ref: { kind: "dropped", id: remote.id }, resource: RESOURCE_ENERGY, available: 200 })
    );
  });

  it("leaves the home providers untouched when remote energy is added (additive)", () => {
    const container = containerAt(10, 10, 300);
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const home = providers(colonySnap({ containers: [container] }));
    const both = providers(colonySnap({ containers: [container], remoteEnergy: [remote] }));

    // Every home provider still present, unchanged; remote is purely additional.
    for (const p of home) expect(both).toContainEqual(p);
    expect(both).toHaveLength(home.length + 1);
  });

  it("excludes remote energy below the worthwhile floor", () => {
    const remote = remoteEnergyAt("W2N1", 10, "dropped");
    expect(providers(colonySnap({ remoteEnergy: [remote] }))).toEqual([]);
  });

  it("withholds remote energy while the home spawn system is still short", () => {
    // energyAvailable < energyCapacity => a home spawn deficit; a cross-room haul must not be offered.
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const snap = colonySnap({ remoteEnergy: [remote], energyAvailable: 200, energyCapacity: 550 });

    expect(providers(snap).some(p => p.ref.kind === "dropped" && p.ref.id === remote.id)).toBe(false);
  });

  it("includes a tombstone's energy above the worthwhile floor", () => {
    const tombstone = tombstoneAt(15, 15, 100);
    const result = providers(colonySnap({ tombstones: [tombstone] }));

    expect(result).toEqual([
      { ref: { kind: "tombstone", id: tombstone.id }, resource: RESOURCE_ENERGY, available: 100, urgency: 1 }
    ]);
  });

  it("excludes a tombstone below the worthwhile floor", () => {
    const tombstone = tombstoneAt(15, 15, 10);
    expect(providers(colonySnap({ tombstones: [tombstone] }))).toEqual([]);
  });

  const storageId = "storage1" as Id<StructureStorage>;

  it("offers storage as a provider only while the spawn system is not full", () => {
    // Spawn/extension deficit present (30 of 50): storage should drain to feed it — supply's old job.
    const result = providers(
      colonySnap({ storageId, storageEnergy: 5000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result).toContainEqual({
      ref: { kind: "structure", id: storageId },
      resource: RESOURCE_ENERGY,
      available: 5000,
      urgency: 0
    });
  });

  it("does not offer storage as a provider when the spawn system is full", () => {
    // No spawn deficit: storage is a sink this tick, never a source — the mutual-exclusion invariant.
    const result = providers(
      colonySnap({ storageId, storageEnergy: 5000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === storageId)).toBe(false);
  });

  it("does not offer empty storage as a provider", () => {
    const result = providers(
      colonySnap({ storageId, storageEnergy: 0, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === storageId)).toBe(false);
  });
});

describe("consumers", () => {
  it("emits one consumer per spawn/extension with free capacity, keyed by its own id", () => {
    const result = consumers(
      colonySnap({ spawnSinks: [sinkAt(10, 10, 20, 50, "ext1"), sinkAt(11, 10, 0, 50, "ext2")] })
    );

    // ext1 wants 30 (50 cap - 20 held), ext2 wants 50 — each its own consumer at spawn-system priority.
    expect(result).toContainEqual({ ref: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, wanted: 30, priority: 100 });
    expect(result).toContainEqual({ ref: { kind: "structure", id: "ext2" }, resource: RESOURCE_ENERGY, wanted: 50, priority: 100 });
    // No single-node aggregate is emitted anymore.
    expect(result.some(c => c.ref.kind === "spawnSystem")).toBe(false);
  });

  it("omits a spawn/extension sink once it is full", () => {
    const result = consumers(colonySnap({ spawnSinks: [sinkAt(10, 10, 50, 50, "ext1")] }));
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === "ext1")).toBe(false);
  });

  it("wants a controller container below its 0.7 fill floor", () => {
    // Within range 2 of the controller at (25,25); capacity 2000 * 0.7 = 1400 floor, holding 300.
    const container = containerAt(25, 26, 300);
    const result = consumers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));

    expect(result).toContainEqual({
      ref: { kind: "structure", id: container.id },
      resource: RESOURCE_ENERGY,
      wanted: 1100,
      priority: 80
    });
  });

  it("excludes a controller container already at or above its 0.7 floor", () => {
    const container = containerAt(25, 26, 1400); // exactly at the floor
    const result = consumers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));
    expect(result.some(c => c.ref.kind === "structure")).toBe(false);
  });

  it("does not treat a non-controller container as a consumer", () => {
    const container = containerAt(10, 10, 300); // far from controller at (25,25)
    const result = consumers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));
    expect(result.some(c => c.ref.kind === "structure")).toBe(false);
  });

  it("wants a tower's shortfall, ranked above the controller container", () => {
    const tower = towerAt(5, 5, "tower_5_5", 400); // 1000 capacity - 400 stored = 600 wanted
    const result = consumers(colonySnap({ towers: [tower] }));

    expect(result).toContainEqual({
      ref: { kind: "structure", id: tower.id },
      resource: RESOURCE_ENERGY,
      wanted: 600,
      priority: 90
    });
    // spawn/extension (100) > tower (90) > controller-container (80) — deliberately NOT hauler.ts's
    // order, which ranks controller-container above tower.
    const containerConsumer = consumers(colonySnap({ containers: [containerAt(25, 26, 300)], controller: { x: 25, y: 25 } }))[0];
    expect(result[0].priority).toBeGreaterThan(containerConsumer.priority);
  });

  it("omits a tower already at capacity", () => {
    const tower = towerAt(5, 5, "tower_5_5", 1000);
    expect(consumers(colonySnap({ towers: [tower] }))).toEqual([]);
  });

  // Builder/upgrader as direct creep sinks: without this, once transport claims every ground pile
  // for spawn/extension refill, a builder/upgrader has nothing to scavenge and falls back to slow
  // self-harvest — this was the regression that stalled construction/upgrading under maxHaulers:0.
  it("wants a builder's shortfall, ranked below the controller container but above upgrader", () => {
    const builder = snapCreep("builder", { storeEnergy: 20, storeCapacity: 100 });
    const upgrader = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100 });
    const result = consumers(colonySnap({ creeps: [builder, upgrader] }));

    const builderConsumer = result.find(c => c.ref.kind === "creep" && c.ref.id === builder.id);
    const upgraderConsumer = result.find(c => c.ref.kind === "creep" && c.ref.id === upgrader.id);

    expect(builderConsumer).toEqual({ ref: { kind: "creep", id: builder.id }, resource: RESOURCE_ENERGY, wanted: 80, priority: 40 });
    expect(upgraderConsumer).toEqual({ ref: { kind: "creep", id: upgrader.id }, resource: RESOURCE_ENERGY, wanted: 80, priority: 30 });
    expect(builderConsumer!.priority).toBeGreaterThan(upgraderConsumer!.priority);

    const containerConsumer = consumers(colonySnap({ containers: [containerAt(25, 26, 300)], controller: { x: 25, y: 25 } }))[0];
    expect(containerConsumer.priority).toBeGreaterThan(builderConsumer!.priority);
  });

  it("omits a builder or upgrader already full", () => {
    const builder = snapCreep("builder", { storeEnergy: 100, storeCapacity: 100 });
    const upgrader = snapCreep("upgrader", { storeEnergy: 100, storeCapacity: 100 });
    expect(consumers(colonySnap({ creeps: [builder, upgrader] }))).toEqual([]);
  });

  it("ignores creeps that are neither builder nor upgrader", () => {
    const miner = snapCreep("miner", { storeEnergy: 0, storeCapacity: 50 });
    expect(consumers(colonySnap({ creeps: [miner] })).some(c => c.ref.kind === "creep")).toBe(false);
  });

  it("only treats an upgrader within 5 tiles of the controller as a consumer", () => {
    const near = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100, x: 25, y: 30 }); // 5 tiles: viable
    const far = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100, x: 25, y: 31 }); // 6 tiles: off-target
    const result = consumers(colonySnap({ creeps: [near, far], controller: { x: 25, y: 25 } }));

    expect(result.some(c => c.ref.kind === "creep" && c.ref.id === near.id)).toBe(true);
    expect(result.some(c => c.ref.kind === "creep" && c.ref.id === far.id)).toBe(false);
  });

  const storageId = "storage1" as Id<StructureStorage>;

  it("wants storage's free capacity as the lowest-priority overflow sink once the spawn system is full", () => {
    // Spawn full, so storage is the overflow buffer: 10000 - 4000 = 6000 free, ranked below upgrader (30).
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    const storageConsumer = result.find(c => c.ref.kind === "structure" && c.ref.id === storageId);
    expect(storageConsumer).toEqual({ ref: { kind: "structure", id: storageId }, resource: RESOURCE_ENERGY, wanted: 6000, priority: 20 });

    const upgrader = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100, x: 25, y: 25 });
    const upgraderConsumer = consumers(colonySnap({ creeps: [upgrader], controller: { x: 25, y: 25 } })).find(
      c => c.ref.kind === "creep"
    );
    expect(upgraderConsumer!.priority).toBeGreaterThan(storageConsumer!.priority);
  });

  it("does not treat storage as a sink while the spawn system still wants energy", () => {
    // Spawn deficit present: storage is a source this tick, never a sink — the mutual-exclusion invariant.
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === storageId)).toBe(false);
  });

  it("does not treat full storage as a sink", () => {
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 10000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === storageId)).toBe(false);
  });
});
