// Pure fixture tests, no Game mocking — a hand-built ColonySnapshot in, Provider[]/Consumer[] out.

import { describe, expect, it } from "vitest";
import { consumers, providers, storageOverflow, supplyConsumers, supplyProviders, transportProviders } from "../../../src/logistics/graph";
import {
  colonySnap,
  containerAt,
  dropAt,
  mineralAt,
  remoteEnergyAt,
  remoteSourceAt,
  sinkAt,
  snapCreep,
  structureAt,
  tombstoneAt,
  towerAt
} from "../../fixtures";

describe("providers", () => {
  it("treats a source container holding energy as a provider", () => {
    const container = containerAt(10, 10, 300);
    const result = providers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));

    expect(result).toEqual([
      { ref: { kind: "structure", id: container.id }, resource: RESOURCE_ENERGY, available: 300, urgency: 0.15, pos: { x: 10, y: 10 } }
    ]);
  });

  it("excludes an empty source container", () => {
    const container = containerAt(10, 10, 0);
    expect(providers(colonySnap({ containers: [container] }))).toEqual([]);
  });

  it("excludes the controller container from providers even when it holds energy", () => {
    // Within range 1 of the controller at (25,25).
    const container = containerAt(25, 26, 1000);
    expect(providers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }))).toEqual([]);
  });

  it("includes a dropped pile above the worthwhile floor", () => {
    const drop = dropAt(15, 15, 100);
    const result = providers(colonySnap({ drops: [drop] }));

    expect(result).toEqual([
      { ref: { kind: "dropped", id: drop.id }, resource: RESOURCE_ENERGY, available: 100, urgency: 1, pos: { x: 15, y: 15 } }
    ]);
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

  it("still offers remote energy while the home spawn system is short", () => {
    // energyAvailable < energyCapacity => a home spawn deficit; remote is still offered as an extra
    // option — allocate.ts's nearest-fill already prefers home providers when one alone covers the trip.
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const snap = colonySnap({ remoteEnergy: [remote], energyAvailable: 200, energyCapacity: 550 });

    expect(providers(snap).some(p => p.ref.kind === "dropped" && p.ref.id === remote.id)).toBe(true);
  });

  it("attaches the matching remote source's cached route length as remoteDistance for a container", () => {
    // allocate.ts's nearest-fill needs a real-path-comparable distance for a remote provider (pos:
    // null rules out a live path search across rooms) — the container sits on one specific source's
    // drop spot, matched by containerId, so its route length is exact rather than a same-room guess.
    const source = remoteSourceAt(10, 10, "W2N1", { containerId: "cont1" as Id<StructureContainer>, distance: 42 });
    const remote = remoteEnergyAt("W2N1", 200, "container", "cont1");
    const result = providers(colonySnap({ remoteSources: [source], remoteEnergy: [remote] }));

    expect(result).toContainEqual(expect.objectContaining({ remote: true, remoteDistance: 42 }));
  });

  it("falls back to any source in the room for a dropped pile with no container to match against", () => {
    const source = remoteSourceAt(10, 10, "W2N1", { distance: 17 });
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const result = providers(colonySnap({ remoteSources: [source], remoteEnergy: [remote] }));

    expect(result).toContainEqual(expect.objectContaining({ remote: true, remoteDistance: 17 }));
  });

  it("leaves remoteDistance undefined when no remote source is recorded for that room", () => {
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const result = providers(colonySnap({ remoteEnergy: [remote] }));

    expect(result[0]?.remoteDistance).toBeUndefined();
  });

  it("includes a tombstone's energy above the worthwhile floor", () => {
    const tombstone = tombstoneAt(15, 15, 100);
    const result = providers(colonySnap({ tombstones: [tombstone] }));

    expect(result).toEqual([
      { ref: { kind: "tombstone", id: tombstone.id }, resource: RESOURCE_ENERGY, available: 100, urgency: 1, pos: { x: 15, y: 15 } }
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
      urgency: 0,
      pos: null,
      storageBuffer: true
    });
  });

  it("does not offer storage as a provider when the spawn system is full", () => {
    // No spawn deficit: storage is a sink this tick, never a source — the mutual-exclusion invariant.
    const result = providers(
      colonySnap({ storageId, storageEnergy: 5000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === storageId)).toBe(false);
  });

  it("resolves storage's position from the matching structure, for nearest-fill pickup selection", () => {
    const storageStruct = structureAt(12, 8, STRUCTURE_STORAGE, { id: storageId as unknown as Id<Structure> });
    const result = providers(
      colonySnap({
        storageId,
        storageEnergy: 5000,
        storageCapacity: 10000,
        energyAvailable: 30,
        energyCapacity: 50,
        structures: [storageStruct]
      })
    );
    expect(result).toContainEqual(expect.objectContaining({ pos: { x: 12, y: 8 } }));
  });

  it("does not offer empty storage as a provider", () => {
    const result = providers(
      colonySnap({ storageId, storageEnergy: 0, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === storageId)).toBe(false);
  });

  // Issue #42 (M0): the mineral container is a provider, same shape as a source container, just keyed
  // by the room's own mineral type rather than energy.
  it("treats the mineral container as a provider once it holds mineral", () => {
    const mineral = mineralAt(30, 30, {
      containerId: "mineralContainer1" as Id<StructureContainer>,
      containerMineral: 500,
      containerCapacity: 2000
    });
    const result = providers(colonySnap({ mineral }));

    expect(result).toContainEqual({
      ref: { kind: "structure", id: mineral.containerId },
      resource: mineral.mineralType,
      available: 500,
      urgency: 0,
      pos: { x: mineral.x, y: mineral.y }
    });
  });

  it("excludes the mineral container as a provider while empty", () => {
    const mineral = mineralAt(30, 30, { containerId: "mineralContainer1" as Id<StructureContainer>, containerMineral: 0 });
    const result = providers(colonySnap({ mineral }));
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === mineral.containerId)).toBe(false);
  });

  it("excludes a mineral with no container built yet from providers", () => {
    const mineral = mineralAt(30, 30); // no containerId
    expect(providers(colonySnap({ mineral })).some(p => p.resource === mineral.mineralType)).toBe(false);
  });
});

describe("consumers", () => {
  it("emits one consumer per spawn/extension with free capacity, keyed by its own id", () => {
    const result = consumers(
      colonySnap({ spawnSinks: [sinkAt(10, 10, 20, 50, "ext1"), sinkAt(11, 10, 0, 50, "ext2")] })
    );

    // ext1 wants 30 (50 cap - 20 held), ext2 wants 50 — each its own consumer at spawn-system priority.
    expect(result).toContainEqual({ ref: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, wanted: 30, priority: 60, pos: { x: 10, y: 10 } });
    expect(result).toContainEqual({ ref: { kind: "structure", id: "ext2" }, resource: RESOURCE_ENERGY, wanted: 50, priority: 60, pos: { x: 11, y: 10 } });
    // No single-node aggregate is emitted anymore.
    expect(result.some(c => c.ref.kind === "spawnSystem")).toBe(false);
  });

  it("omits a spawn/extension sink once it is full", () => {
    const result = consumers(colonySnap({ spawnSinks: [sinkAt(10, 10, 50, 50, "ext1")] }));
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === "ext1")).toBe(false);
  });

  it("wants a controller container below its 0.7 fill floor", () => {
    // Within range 1 of the controller at (25,25); capacity 2000 * 0.7 = 1400 floor, holding 300.
    const container = containerAt(25, 26, 300);
    const result = consumers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));

    expect(result).toContainEqual({
      ref: { kind: "structure", id: container.id },
      resource: RESOURCE_ENERGY,
      wanted: 1100,
      priority: 80,
      pos: { x: 25, y: 26 }
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
      priority: 90,
      pos: { x: 5, y: 5 }
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

    expect(builderConsumer).toEqual({ ref: { kind: "creep", id: builder.id }, resource: RESOURCE_ENERGY, wanted: 80, priority: 40, pos: { x: 25, y: 25 } });
    expect(upgraderConsumer).toEqual({ ref: { kind: "creep", id: upgrader.id }, resource: RESOURCE_ENERGY, wanted: 80, priority: 30, pos: { x: 25, y: 25 } });
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

  it("wants storage's free capacity as an overflow sink ranked above builder/upgrader once the spawn system is full", () => {
    // Spawn full, so storage is the overflow buffer: 10000 - 4000 = 6000 free, ranked above upgrader (30) —
    // storage should absorb transport's load ahead of the pre-storage hand-to-creep fallback.
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    const storageConsumer = result.find(c => c.ref.kind === "structure" && c.ref.id === storageId);
    expect(storageConsumer).toEqual({ ref: { kind: "structure", id: storageId }, resource: RESOURCE_ENERGY, wanted: 6000, priority: 70, pos: null });

    const upgrader = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100, x: 25, y: 25 });
    const upgraderConsumer = consumers(colonySnap({ creeps: [upgrader], controller: { x: 25, y: 25 } })).find(
      c => c.ref.kind === "creep"
    );
    expect(storageConsumer!.priority).toBeGreaterThan(upgraderConsumer!.priority);
  });

  it("still treats storage as a sink while the spawn system wants energy", () => {
    // Spawn deficit present: storage remains an overflow consumer regardless — only storage-as-source
    // (providers()) gates on the deficit. A spawn short by even 1 energy must not disable storage as the
    // only remaining sink for a full source container once spawn/tower/controller-container are covered.
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    const storageConsumer = result.find(c => c.ref.kind === "structure" && c.ref.id === storageId);
    expect(storageConsumer).toEqual({ ref: { kind: "structure", id: storageId }, resource: RESOURCE_ENERGY, wanted: 6000, priority: 70, pos: null });
  });

  it("does not treat full storage as a sink", () => {
    const result = consumers(
      colonySnap({ storageId, storageEnergy: 10000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === storageId)).toBe(false);
  });

  it("stops offering builder/upgrader as direct sinks once storage exists, even while storage itself is full", () => {
    // Storage full (not a sink itself this tick) but still present: transport should NOT fall back to
    // hand-feeding builder/upgrader directly — that pre-storage fallback is retired once storage exists.
    const builder = snapCreep("builder", { storeEnergy: 20, storeCapacity: 100 });
    const upgrader = snapCreep("upgrader", { storeEnergy: 20, storeCapacity: 100, x: 25, y: 25 });
    const result = consumers(
      colonySnap({
        storageId,
        storageEnergy: 10000,
        storageCapacity: 10000,
        energyAvailable: 50,
        energyCapacity: 50,
        creeps: [builder, upgrader],
        controller: { x: 25, y: 25 }
      })
    );
    expect(result.some(c => c.ref.kind === "creep")).toBe(false);
  });

  // Issue #42 (M0): storage is the sole mineral consumer — no controller-container/tower/spawn-
  // equivalent tier exists for a raw mineral.
  it("wants storage's real free capacity as a mineral consumer, accounting for mineral already stored", () => {
    const mineral = mineralAt(30, 30, { containerId: "mineralContainer1" as Id<StructureContainer> });
    const result = consumers(
      colonySnap({ mineral, storageId, storageEnergy: 1000, storageCapacity: 10000, storageMineral: 500, energyAvailable: 50, energyCapacity: 50 })
    );
    const mineralConsumer = result.find(c => c.resource === mineral.mineralType);
    // 10000 - 1000 (energy) - 500 (mineral already stored) = 8500 real free capacity.
    expect(mineralConsumer).toEqual({
      ref: { kind: "structure", id: storageId },
      resource: mineral.mineralType,
      wanted: 8500,
      priority: 70,
      pos: null
    });
  });

  it("wants no mineral consumer before storage exists", () => {
    const mineral = mineralAt(30, 30, { containerId: "mineralContainer1" as Id<StructureContainer> });
    const result = consumers(colonySnap({ mineral }));
    expect(result.some(c => c.resource === mineral.mineralType)).toBe(false);
  });

  it("does not want a mineral consumer once storage is genuinely full", () => {
    const mineral = mineralAt(30, 30, { containerId: "mineralContainer1" as Id<StructureContainer> });
    const result = consumers(
      colonySnap({ mineral, storageId, storageEnergy: 5000, storageCapacity: 10000, storageMineral: 5000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(c => c.resource === mineral.mineralType)).toBe(false);
  });

  it("never lets a mineral consumer's resource collide with the energy storage consumer", () => {
    const mineral = mineralAt(30, 30, { containerId: "mineralContainer1" as Id<StructureContainer> });
    const result = consumers(
      colonySnap({ mineral, storageId, storageEnergy: 1000, storageCapacity: 10000, storageMineral: 0, energyAvailable: 50, energyCapacity: 50 })
    );
    const storageConsumers = result.filter(c => c.ref.kind === "structure" && c.ref.id === storageId);
    expect(storageConsumers).toHaveLength(2); // one energy, one mineral — distinct resources, same structure
    expect(storageConsumers.map(c => c.resource).sort()).toEqual([mineral.mineralType, RESOURCE_ENERGY].sort());
  });
});

// storageOverflow is the escape hatch for a loaded transport creep that found no live consumer this
// tick: unlike consumers()/providers() above, it is NOT gated on the spawn-deficit invariant, since it's
// only ever used by allocate.ts as a delivery target for cargo the creep already carries — never a
// pickup source — so it can't recreate the self-feeding loop that gate exists to prevent.
describe("storageOverflow", () => {
  const storageId = "storage1" as Id<StructureStorage>;

  it("reports storage's free capacity regardless of a spawn-system deficit", () => {
    const result = storageOverflow(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result).toEqual({ ref: { kind: "structure", id: storageId }, free: 6000 });
  });

  it("returns null when there is no storage yet", () => {
    expect(storageOverflow(colonySnap({}))).toBeNull();
  });

  it("returns null when storage is already full", () => {
    expect(storageOverflow(colonySnap({ storageId, storageEnergy: 10000, storageCapacity: 10000 }))).toBeNull();
  });
});

// Supply's restricted view: storage/local piles in, spawn/extension/tower only out — never a remote
// pickup or a controller-container/builder/upgrader/storage delivery, which stay transport's job alone.
describe("supplyProviders", () => {
  it("includes a local source container, same as the general provider list", () => {
    const container = containerAt(10, 10, 300);
    const result = supplyProviders(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));
    expect(result).toContainEqual(expect.objectContaining({ ref: { kind: "structure", id: container.id }, available: 300 }));
  });

  it("includes storage while the spawn system is short, same gate as the general provider list", () => {
    const storageId = "storage1" as Id<StructureStorage>;
    const result = supplyProviders(
      colonySnap({ storageId, storageEnergy: 5000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result).toContainEqual(expect.objectContaining({ ref: { kind: "structure", id: storageId } }));
  });

  it("excludes a remote-room provider even though it is worth a trip", () => {
    const remote = remoteEnergyAt("W2N1", 200, "dropped");
    const result = supplyProviders(colonySnap({ remoteEnergy: [remote] }));
    expect(result.some(p => p.remote)).toBe(false);
    expect(result).toEqual([]);
  });
});

// Transport's restricted view: everything the general list offers EXCEPT storage's drain-for-spawn-need
// entry — that direction is supply's job alone (supplyProviders, above), never transport's.
describe("transportProviders", () => {
  it("includes a local source container, same as the general provider list", () => {
    const container = containerAt(10, 10, 300);
    const result = transportProviders(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));
    expect(result).toContainEqual(expect.objectContaining({ ref: { kind: "structure", id: container.id }, available: 300 }));
  });

  it("excludes storage's buffer-out entry even while the spawn system is short", () => {
    const storageId = "storage1" as Id<StructureStorage>;
    const result = transportProviders(
      colonySnap({ storageId, storageEnergy: 5000, storageCapacity: 10000, energyAvailable: 30, energyCapacity: 50 })
    );
    expect(result.some(p => p.ref.kind === "structure" && p.ref.id === storageId)).toBe(false);
  });
});

describe("supplyConsumers", () => {
  it("includes a spawn/extension sink", () => {
    const result = supplyConsumers(colonySnap({ spawnSinks: [sinkAt(10, 10, 20, 50, "ext1")] }));
    expect(result).toContainEqual({ ref: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, wanted: 30, priority: 60, pos: { x: 10, y: 10 } });
  });

  it("includes a tower sink", () => {
    const tower = towerAt(5, 5, "tower_5_5", 400);
    const result = supplyConsumers(colonySnap({ towers: [tower] }));
    expect(result).toContainEqual({ ref: { kind: "structure", id: tower.id }, resource: RESOURCE_ENERGY, wanted: 600, priority: 90, pos: { x: 5, y: 5 } });
  });

  it("excludes the controller container even below its fill floor", () => {
    const container = containerAt(25, 26, 300);
    const result = supplyConsumers(colonySnap({ containers: [container], controller: { x: 25, y: 25 } }));
    expect(result).toEqual([]);
  });

  it("excludes builder/upgrader direct sinks pre-storage", () => {
    const builder = snapCreep("builder", { storeEnergy: 20, storeCapacity: 100 });
    const result = supplyConsumers(colonySnap({ creeps: [builder] }));
    expect(result.some(c => c.ref.kind === "creep")).toBe(false);
  });

  it("excludes storage as an overflow sink once the spawn system is full", () => {
    const storageId = "storage1" as Id<StructureStorage>;
    const result = supplyConsumers(
      colonySnap({ storageId, storageEnergy: 4000, storageCapacity: 10000, energyAvailable: 50, energyCapacity: 50 })
    );
    expect(result.some(c => c.ref.kind === "structure" && c.ref.id === storageId)).toBe(false);
  });
});
