// Pure fixture tests, no Game mocking — a hand-built ColonySnapshot in, Provider[]/Consumer[] out.

import { describe, expect, it } from "vitest";
import { consumers, providers } from "../../../src/logistics/graph";
import { colonySnap, containerAt, dropAt } from "../../fixtures";

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
});
