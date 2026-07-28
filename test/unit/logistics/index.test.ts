// planLogistics is thin (wires graph + allocate + reserved-folding), so one integration-style case per
// behavior is enough — the interesting logic already has its own unit tests in graph/allocate.

import { describe, expect, it } from "vitest";
import { planLogistics } from "../../../src/logistics";
import { colonySnap, containerAt, snapCreep } from "../../fixtures";

describe("planLogistics", () => {
  it("assigns one idle transport creep given one provider and one consumer", () => {
    const creep = snapCreep("transport", { storeEnergy: 0, storeCapacity: 100 });
    const container = containerAt(10, 10, 300);
    const plan = planLogistics(
      colonySnap({
        creeps: [creep],
        containers: [container],
        controller: { x: 25, y: 25 },
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
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(plan.assignments[idle.id]).toBeUndefined();
  });
});
