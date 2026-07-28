// No snapshot needed — hand-built Provider[]/Consumer[]/SnapCreep[] arrays, fully unit-testable.

import { describe, expect, it } from "vitest";
import { allocate, emptyReserved, type ReservedAmounts } from "../../../src/logistics/allocate";
import type { Consumer, Provider } from "../../../src/logistics/graph";
import { snapCreep } from "../../fixtures";

const idleHauler = (over: Partial<{ storeEnergy: number; storeCapacity: number }> = {}) =>
  snapCreep("hauler", { storeEnergy: 0, storeCapacity: 100, ...over });

const provider = (id: string, available: number): Provider => ({
  ref: { kind: "structure", id: id as Id<AnyStoreStructure> },
  resource: RESOURCE_ENERGY,
  available,
  urgency: 0
});

const consumer = (id: string, wanted: number, priority = 50): Consumer => ({
  ref: { kind: "structure", id: id as Id<AnyStoreStructure> },
  resource: RESOURCE_ENERGY,
  wanted,
  priority
});

describe("allocate", () => {
  it("assigns only one of two idle creeps when the consumer's demand is smaller than their combined capacity", () => {
    const creepA = idleHauler();
    const creepB = idleHauler();
    const result = allocate([provider("src", 1000)], [consumer("sink", 80)], [creepA, creepB], emptyReserved());

    const assigned = Object.keys(result);
    expect(assigned).toHaveLength(1);
    expect(result[assigned[0] as Id<Creep>]).toMatchObject({ kind: "pickup", amount: 80 });
  });

  it("gives a partially-loaded creep a deliver task using its current load, never a redundant pickup", () => {
    const creep = idleHauler({ storeEnergy: 40 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], emptyReserved());

    expect(result[creep.id]).toEqual({ kind: "deliver", to: { kind: "structure", id: "sink" }, resource: RESOURCE_ENERGY, amount: 40 });
  });

  it("does not double-book a provider/consumer already reserved by a mid-task creep", () => {
    const reserved: ReservedAmounts = { providers: { "structure:src": 1000 }, consumers: {} };
    const creep = idleHauler();
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], reserved);

    expect(result[creep.id]).toBeUndefined(); // provider fully claimed already
  });

  it("serves higher-priority consumers first and starves lower-priority ones when supply is short", () => {
    const creepA = idleHauler();
    const creepB = idleHauler();
    const highPriority = consumer("urgent", 100, 90);
    const lowPriority = consumer("minor", 100, 10);

    const result = allocate([provider("src", 100)], [lowPriority, highPriority], [creepA, creepB], emptyReserved());

    const tasks = Object.values(result);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ to: { kind: "structure", id: "urgent" } });
  });

  it("assigns nothing to a creep with no free capacity and no current load", () => {
    const creep = idleHauler({ storeCapacity: 0 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 100)], [creep], emptyReserved());
    expect(result[creep.id]).toBeUndefined();
  });

  it("assigns nothing when there are no consumers", () => {
    const creep = idleHauler();
    expect(allocate([provider("src", 1000)], [], [creep], emptyReserved())).toEqual({});
  });

  it("assigns nothing when there are no providers for an empty creep", () => {
    const creep = idleHauler();
    expect(allocate([], [consumer("sink", 100)], [creep], emptyReserved())).toEqual({});
  });
});
