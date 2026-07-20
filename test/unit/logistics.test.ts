import { describe, expect, it } from "vitest";
import { desiredHaulerCount } from "../../src/systems/logistics";
import { colony, containerAt } from "../fixtures";

describe("desiredHaulerCount", () => {
  it("wants no haulers when there is nothing to haul from", () => {
    expect(desiredHaulerCount(colony({ containers: [] }))).toBe(0);
  });

  it("wants one hauler per active container", () => {
    expect(desiredHaulerCount(colony({ containers: [containerAt(10, 10, 500)], energyAvailable: 550 }))).toBe(1);
    expect(
      desiredHaulerCount(
        colony({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 500)], energyAvailable: 550 })
      )
    ).toBe(2);
  });

  it("ignores containers that are sitting empty", () => {
    expect(
      desiredHaulerCount(
        colony({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 0)], energyAvailable: 550 })
      )
    ).toBe(1);
  });

  it("wants no haulers when the colony cannot afford even one body", () => {
    expect(desiredHaulerCount(colony({ containers: [containerAt(10, 10, 500)], energyCapacity: 100 }))).toBe(0);
  });
});
