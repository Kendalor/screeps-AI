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

const drop = (id: string, available: number): Provider => ({
  ref: { kind: "dropped", id: id as Id<Resource> },
  resource: RESOURCE_ENERGY,
  available,
  urgency: 1
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

  it("pairs a pickup with its deliver as `next` so the creep flows straight through with no idle tick", () => {
    const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
    const result = allocate([provider("src", 1000)], [consumer("sink", 200)], [creep], emptyReserved());

    const task = result[creep.id];
    expect(task).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "src" }, amount: 100 });
    expect(task?.next).toEqual({
      kind: "deliver",
      to: { kind: "structure", id: "sink" },
      resource: RESOURCE_ENERGY,
      amount: 100
    });
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

  describe("speculative pickup from decaying sources", () => {
    it("sends an empty creep to a dropped pile even when no consumer is waiting, with no deliver leg", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([drop("d1", 500)], [], [creep], emptyReserved());

      expect(result[creep.id]).toEqual({
        kind: "pickup",
        from: { kind: "dropped", id: "d1" },
        resource: RESOURCE_ENERGY,
        amount: 100
      });
      expect(result[creep.id]?.to).toBeUndefined();
      expect(result[creep.id]?.next).toBeUndefined();
    });

    it("does NOT speculatively pick up from a non-decaying container when no consumer is waiting", () => {
      const creep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const result = allocate([provider("cont", 500)], [], [creep], emptyReserved());
      expect(result[creep.id]).toBeUndefined();
    });

    it("does not over-book a drop across the consumer-driven pass and the speculative pass", () => {
      const consumerCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      const speculativeCreep = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
      // Only 120 on the ground: 100 goes to the consumer-driven pickup, 20 left for the speculative one.
      const result = allocate([drop("d1", 120)], [consumer("sink", 100)], [consumerCreep, speculativeCreep], emptyReserved());

      expect(result[consumerCreep.id]).toMatchObject({ kind: "pickup", to: { kind: "structure", id: "sink" }, amount: 100 });
      expect(result[speculativeCreep.id]).toMatchObject({ kind: "pickup", amount: 20 });
      expect(result[speculativeCreep.id]?.to).toBeUndefined();
    });

    it("leaves a full creep idle rather than sending it to a drop it cannot carry", () => {
      const full = idleHauler({ storeEnergy: 100, storeCapacity: 100 });
      const result = allocate([drop("d1", 500)], [], [full], emptyReserved());
      expect(result[full.id]).toBeUndefined();
    });
  });

  it("processes loaded creeps before empty ones so a pre-loaded creep wins the deliver", () => {
    // One consumer wanting 100. A loaded creep (carrying 100) and an empty creep both idle. The loaded
    // creep must get the deliver — no reason to send the empty one on a round trip while a ready creep waits.
    const loaded = idleHauler({ storeEnergy: 100, storeCapacity: 100 });
    const empty = idleHauler({ storeEnergy: 0, storeCapacity: 100 });
    // Pass empty first to prove ordering is by load, not input order.
    const result = allocate([provider("src", 1000)], [consumer("sink", 100)], [empty, loaded], emptyReserved());

    expect(result[loaded.id]).toMatchObject({ kind: "deliver", to: { kind: "structure", id: "sink" }, amount: 100 });
    expect(result[empty.id]).toBeUndefined(); // demand already met by the loaded creep
  });
});
