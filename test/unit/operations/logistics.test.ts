// Mirrors supply.test.ts's structure — the smallest existing operation test. Every case constructs the
// operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Logistics } from "../../../src/operations/logistics";
import { colonySnap, containerAt, snapCreeps } from "../../fixtures";

const logistics = new Logistics("W1N1");

describe("Logistics.desiredCreeps", () => {
  // A fresh colony has no containers/drops and no spawn deficit — nothing for a transport creep to
  // do yet, so asking anyway would outrank upgrader for a spawn slot on work that doesn't exist.
  it("wants nothing when there is no provider or consumer work yet", () => {
    expect(logistics.desiredCreeps(colonySnap({}))).toEqual([]);
  });

  const withWork = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({
      containers: [containerAt(10, 10, 300)],
      controller: { x: 25, y: 25 },
      energyAvailable: 200,
      energyCapacity: 300,
      ...over
    });

  it("wants one transport creep once a provider and consumer both exist", () => {
    expect(logistics.desiredCreeps(withWork())).toHaveLength(1);
  });

  it("returns nothing once the live transport creeps meet the quota", () => {
    expect(logistics.desiredCreeps(withWork({ creeps: snapCreeps("transport", 1) }))).toEqual([]);
  });

  it("stamps its own op name on every request", () => {
    const [request] = logistics.desiredCreeps(withWork());
    expect(request.memory).toMatchObject({ role: "transport", home: "W1N1", op: "logistics:W1N1" });
  });
});

describe("Logistics.intents", () => {
  it("emits an assignLogisticsTask intent for an idle transport creep with work available", () => {
    const creep = snapCreeps("transport", 1, { storeEnergy: 0, storeCapacity: 100 })[0];
    const container = containerAt(10, 10, 300);
    const intents = logistics.intents(
      colonySnap({
        creeps: [creep],
        containers: [container],
        controller: { x: 25, y: 25 },
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(intents).toEqual([
      expect.objectContaining({ kind: "assignLogisticsTask", creep: creep.id })
    ]);
  });

  it("emits nothing when there are no idle transport creeps or no work", () => {
    expect(logistics.intents(colonySnap({}))).toEqual([]);
  });
});
