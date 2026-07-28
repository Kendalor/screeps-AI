// planLogistics is thin (wires graph + allocate + reserved-folding), so one integration-style case per
// behavior is enough — the interesting logic already has its own unit tests in graph/allocate.

import { describe, expect, it } from "vitest";
import { planLogistics } from "../../../src/logistics";
import { colonySnap, containerAt, sinkAt, snapCreep } from "../../fixtures";

describe("planLogistics", () => {
  it("assigns one idle transport creep given one provider and one consumer", () => {
    const creep = snapCreep("transport", { storeEnergy: 0, storeCapacity: 100 });
    const container = containerAt(10, 10, 300);
    const plan = planLogistics(
      colonySnap({
        creeps: [creep],
        containers: [container],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")], // one empty spawn wanting 100
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(plan.assignments[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: container.id } });
  });

  it("does nothing when there are no idle transport creeps", () => {
    const busy = snapCreep("transport", { memory: { logistics: { current: { kind: "deliver", resource: RESOURCE_ENERGY, amount: 10 } } } });
    const plan = planLogistics(colonySnap({ creeps: [busy], energyAvailable: 0, energyCapacity: 300 }));
    expect(plan.assignments).toEqual({});
  });

  it("reserves a mid-task chain's consumer off its deliver leg, leaving the rest open for an idle creep", () => {
    // The busy creep's chain fills spawn1 (100) then a second sink spawn2 is still open. Folding must
    // reserve spawn1 (via the deliver leg), leaving spawn2's 100 for the idle creep.
    const container = containerAt(10, 10, 400);
    const busy = snapCreep("transport", {
      memory: {
        logistics: {
          current: {
            kind: "pickup",
            from: { kind: "structure", id: container.id },
            to: { kind: "structure", id: "spawn1" as Id<AnyStoreStructure> },
            resource: RESOURCE_ENERGY,
            amount: 100,
            next: { kind: "deliver", to: { kind: "structure", id: "spawn1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 100 }
          }
        }
      }
    });
    const idle = snapCreep("transport", { storeEnergy: 0, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [busy, idle],
        containers: [container],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1"), sinkAt(21, 20, 0, 100, "spawn2")],
        energyAvailable: 100,
        energyCapacity: 300
      })
    );

    // spawn1 is reserved by the busy chain, so the idle creep is sent to fill spawn2.
    const idleTask = plan.assignments[idle.id];
    expect(idleTask?.kind).toBe("pickup");
    // Its deliver leg targets spawn2 (the still-open sink), not the reserved spawn1.
    let deliver = idleTask?.next;
    while (deliver && deliver.kind !== "deliver") deliver = deliver.next;
    expect(deliver?.to).toEqual({ kind: "structure", id: "spawn2" });
  });

  it("reserves every provider in a mid-task creep's pickup chain, not just the first", () => {
    // A busy creep is fetching from TWO containers in one chained trip (cont1 then cont2) to spawn.
    // Folding must reserve BOTH providers so an idle creep isn't sent to cont2 for energy already spoken for.
    // Each container holds exactly what the chain plans to take, so the reservation fully claims both.
    const cont1 = containerAt(10, 10, 100);
    const cont2 = containerAt(12, 12, 100);
    const busy = snapCreep("transport", {
      memory: {
        logistics: {
          current: {
            kind: "pickup",
            from: { kind: "structure", id: cont1.id },
            to: { kind: "structure", id: "spawn1" as Id<AnyStoreStructure> }, // head-pointer hint the allocator sets
            resource: RESOURCE_ENERGY,
            amount: 100,
            next: {
              kind: "pickup",
              from: { kind: "structure", id: cont2.id },
              to: { kind: "structure", id: "spawn1" as Id<AnyStoreStructure> },
              resource: RESOURCE_ENERGY,
              amount: 100,
              next: { kind: "deliver", to: { kind: "structure", id: "spawn1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 200 }
            }
          }
        }
      }
    });
    const idle = snapCreep("transport", { storeEnergy: 0, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [busy, idle],
        containers: [cont1, cont2],
        controller: { x: 25, y: 25 },
        // A second open sink so the idle creep WOULD want work — proving it's the provider reservation,
        // not a lack of demand, that leaves it with no container to draw from.
        spawnSinks: [sinkAt(20, 20, 100, 200, "spawn1"), sinkAt(22, 20, 0, 100, "spawn2")],
        energyAvailable: 100,
        energyCapacity: 300
      })
    );

    // Both containers are reserved by the busy creep's chain, so the idle creep has no provider to draw
    // from even though spawn2 is open demand — it must not be sent to either reserved container.
    const idleTask = plan.assignments[idle.id];
    if (idleTask) {
      expect(idleTask.from).not.toEqual({ kind: "structure", id: cont1.id });
      expect(idleTask.from).not.toEqual({ kind: "structure", id: cont2.id });
    }
  });

  it("does not double-assign a provider a mid-task creep already reserved", () => {
    const container = containerAt(10, 10, 100);
    const busy = snapCreep("transport", {
      memory: {
        logistics: {
          current: { kind: "pickup", from: { kind: "structure", id: container.id }, resource: RESOURCE_ENERGY, amount: 100 }
        }
      }
    });
    const idle = snapCreep("transport", { storeEnergy: 0, storeCapacity: 50 });
    const plan = planLogistics(
      colonySnap({
        creeps: [busy, idle],
        containers: [container],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")], // open demand — so the block is provider reservation, not lack of it
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(plan.assignments[idle.id]).toBeUndefined();
  });
});
