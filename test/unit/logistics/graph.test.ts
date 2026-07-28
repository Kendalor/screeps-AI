// Pure fixture tests, no Game mocking — a hand-built ColonySnapshot in, Provider[]/Consumer[] out.

import { describe, expect, it } from "vitest";
import { consumers, providers } from "../../../src/logistics/graph";
import { colonySnap, containerAt, dropAt, snapCreep, tombstoneAt, towerAt } from "../../fixtures";

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
});

describe("consumers", () => {
  it("wants the spawn/extension gap as one aggregate node", () => {
    const result = consumers(colonySnap({ energyAvailable: 30, energyCapacity: 50 }));

    expect(result).toContainEqual({ ref: { kind: "spawnSystem" }, resource: RESOURCE_ENERGY, wanted: 20, priority: 100 });
  });

  it("omits the spawn/extension node once full", () => {
    const result = consumers(colonySnap({ energyAvailable: 300, energyCapacity: 300 }));
    expect(result.some(c => c.ref.kind === "spawnSystem")).toBe(false);
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
});
