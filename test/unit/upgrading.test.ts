import { describe, expect, it } from "vitest";
import { upgraderRequests } from "../../src/systems/upgrading";
import { snapCreeps, testColony } from "../fixtures";

// The quota formula is ported verbatim from the upgrader count this replaced, so each count assertion survives
// as an assertion about how many requests come back.
describe("upgraderRequests (ported UpgradeOperation.getMaxUpgraders)", () => {
  it("asks for nothing when energy is too low to sustain even one upgrader body", () => {
    expect(upgraderRequests(testColony({ storageEnergy: 0, energyAvailable: 200, controllerLevel: 1 }))).toEqual([]);
  });

  it("asks for nothing without storage at any RCL — a dedicated upgrader has nothing to withdraw from", () => {
    // The upgrader role has no harvest step; bootstrap's own wraparound upgrade
    // step covers the controller until storage arrives.
    for (const controllerLevel of [1, 2, 3]) {
      expect(upgraderRequests(testColony({ storageEnergy: 0, energyAvailable: 3000, controllerLevel }))).toEqual([]);
    }
  });

  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(upgraderRequests(testColony({ storageEnergy: 100_000, controllerLevel: 4 }))).toHaveLength(0);
    expect(upgraderRequests(testColony({ storageEnergy: 140_000, controllerLevel: 4 }))).toHaveLength(1);
    expect(upgraderRequests(testColony({ storageEnergy: 500_000, controllerLevel: 6 }))).toHaveLength(4);
  });

  it("returns nothing once the live upgraders meet the quota", () => {
    const colony = testColony({
      storageEnergy: 500_000,
      controllerLevel: 6,
      creeps: snapCreeps("upgrader", 4)
    });

    expect(upgraderRequests(colony)).toEqual([]);
  });

  it("asks only for the shortfall when some upgraders are already alive", () => {
    const colony = testColony({
      storageEnergy: 500_000,
      controllerLevel: 6,
      creeps: snapCreeps("upgrader", 3)
    });

    expect(upgraderRequests(colony)).toHaveLength(1);
  });
});
