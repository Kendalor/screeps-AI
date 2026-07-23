// Ported verbatim from systems/upgrading.test.ts — the quota formula did not change, only its owner.
// Each count assertion survives as an assertion about how many requests come back. Constructs the
// operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Upgrading } from "../../../src/operations/upgrading";
import { colonySnap, snapCreeps } from "../../fixtures";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

describe("Upgrading.desiredCreeps (ported UpgradeOperation.getMaxUpgraders)", () => {
  it("asks for nothing when energy is too low to sustain even one upgrader body", () => {
    expect(upgraderRequests({ storageEnergy: 0, energyAvailable: 200, controllerLevel: 1 })).toEqual([]);
  });

  it("asks for nothing without storage at any RCL — a dedicated upgrader has nothing to withdraw from", () => {
    // The upgrader role has no harvest step; bootstrap's own wraparound upgrade
    // step covers the controller until storage arrives.
    for (const controllerLevel of [1, 2, 3]) {
      expect(upgraderRequests({ storageEnergy: 0, energyAvailable: 3000, controllerLevel })).toEqual([]);
    }
  });

  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(upgraderRequests({ storageEnergy: 100_000, controllerLevel: 4 })).toHaveLength(0);
    expect(upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 })).toHaveLength(1);
    expect(upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6 })).toHaveLength(4);
  });

  it("returns nothing once the live upgraders meet the quota", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 4) })
    ).toEqual([]);
  });

  it("asks only for the shortfall when some upgraders are already alive", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 3) })
    ).toHaveLength(1);
  });

  it("stamps its own op name on every request", () => {
    const [request] = upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 });

    expect(request.memory).toMatchObject({ role: "upgrader", home: "W1N1", op: "upgrading:W1N1" });
  });
});
