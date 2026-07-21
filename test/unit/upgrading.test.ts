import { describe, expect, it } from "vitest";
import { desiredUpgraderCount } from "../../src/systems/upgrading";
import { colony } from "../fixtures";

describe("desiredUpgraderCount (ported UpgradeOperation.getMaxUpgraders)", () => {
  it("returns 0 when energy is too low to sustain even one upgrader body", () => {
    expect(desiredUpgraderCount(colony({ storageEnergy: 0, energyAvailable: 200, controllerLevel: 1 }))).toBe(0);
  });

  it("returns 0 without storage at any RCL — a dedicated upgrader has nothing to withdraw from", () => {
    // The upgrader role has no harvest step; bootstrap's own wraparound upgrade
    // step covers the controller until storage arrives.
    expect(desiredUpgraderCount(colony({ storageEnergy: 0, energyAvailable: 3000, controllerLevel: 1 }))).toBe(0);
    expect(desiredUpgraderCount(colony({ storageEnergy: 0, energyAvailable: 3000, controllerLevel: 2 }))).toBe(0);
    expect(desiredUpgraderCount(colony({ storageEnergy: 0, energyAvailable: 3000, controllerLevel: 3 }))).toBe(0);
  });

  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(desiredUpgraderCount(colony({ storageEnergy: 100_000, controllerLevel: 4 }))).toBe(0);
    expect(desiredUpgraderCount(colony({ storageEnergy: 140_000, controllerLevel: 4 }))).toBe(1);
    expect(desiredUpgraderCount(colony({ storageEnergy: 500_000, controllerLevel: 6 }))).toBe(4);
  });
});
