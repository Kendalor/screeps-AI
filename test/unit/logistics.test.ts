import { describe, expect, it } from "vitest";
import { desiredHaulerCount, desiredMinerCount } from "../../src/systems/logistics";
import { colonySnap, containerAt, sourceAt } from "../fixtures";

describe("desiredMinerCount", () => {
  it("wants exactly one miner for a single source when no haulers are alive yet", () => {
    expect(desiredMinerCount(colonySnap({ sources: [sourceAt(20, 10)], census: {} }))).toBe(1);
  });

  it("caps headcount by live hauler count once a hauler exists", () => {
    // Default 300-energy body carries 2 WORK, so one source (target 6 WORK) wants 3 miners
    // once the cold-start floor no longer applies — but only one hauler is alive to collect.
    expect(desiredMinerCount(colonySnap({ sources: [sourceAt(20, 10)], census: { hauler: 1 } }))).toBe(1);
  });

  it("stops applying the one-miner floor once a hauler is alive", () => {
    // Two haulers alive lets the full 3-miner want through unclamped.
    expect(desiredMinerCount(colonySnap({ sources: [sourceAt(20, 10)], census: { hauler: 3 } }))).toBe(3);
  });

  it("reapplies the one-miner floor after all haulers die", () => {
    expect(desiredMinerCount(colonySnap({ sources: [sourceAt(20, 10)], census: { hauler: 0 } }))).toBe(1);
  });

  it("caps headcount by the source's open adjacent tiles, even with haulers to spare", () => {
    // An enclosed source with only one open tile can never seat the 3 miners the quota wants.
    const enclosed = sourceAt(20, 10, "source_20_10", 1);
    expect(desiredMinerCount(colonySnap({ sources: [enclosed], census: { hauler: 5 } }))).toBe(1);
  });

  it("wants fewer, bigger miners as energy capacity grows", () => {
    const small = colonySnap({ sources: [sourceAt(20, 10)], census: { hauler: 5 }, energyCapacity: 300 });
    const large = colonySnap({ sources: [sourceAt(20, 10)], census: { hauler: 5 }, energyCapacity: 1000 });
    expect(desiredMinerCount(large)).toBeLessThan(desiredMinerCount(small));
  });
});

describe("desiredHaulerCount", () => {
  it("wants no haulers when there is nothing to haul from", () => {
    expect(desiredHaulerCount(colonySnap({ containers: [] }))).toBe(0);
  });

  it("wants one hauler per active container", () => {
    expect(desiredHaulerCount(colonySnap({ containers: [containerAt(10, 10, 500)], energyAvailable: 550 }))).toBe(1);
    expect(
      desiredHaulerCount(
        colonySnap({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 500)], energyAvailable: 550 })
      )
    ).toBe(2);
  });

  it("ignores containers that are sitting empty", () => {
    expect(
      desiredHaulerCount(
        colonySnap({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 0)], energyAvailable: 550 })
      )
    ).toBe(1);
  });

  it("wants no haulers when the colony cannot afford even one body", () => {
    expect(desiredHaulerCount(colonySnap({ containers: [containerAt(10, 10, 500)], energyCapacity: 100 }))).toBe(0);
  });
});
