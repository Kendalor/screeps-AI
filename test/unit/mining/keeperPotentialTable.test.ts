import { describe, it, expect } from "vitest";
import { keeperPotential, KEEPER_POTENTIAL_TABLE } from "../../../src/mining/keeperPotentialTable";
import { remotePotential } from "../../../src/mining/remotePotentialTable";
import { MAX_REMOTE_HOPS } from "../../../src/mining/pickRemotes";

describe("keeperPotential", () => {
  it("far outvalues a normal 2-source room at the same hop distance — 3 sources at the keeper rate", () => {
    for (let hops = 0; hops <= MAX_REMOTE_HOPS; hops++) {
      expect(keeperPotential(hops)).toBeGreaterThan(remotePotential(2, hops));
    }
  });

  it("shrinks as hops grow but stays positive within range — a keeper room never breaks even negative by hop 3", () => {
    const near = keeperPotential(0);
    const far = keeperPotential(MAX_REMOTE_HOPS);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });

  it("is 0 past MAX_REMOTE_HOPS", () => {
    expect(keeperPotential(MAX_REMOTE_HOPS + 1)).toBe(0);
    expect(keeperPotential(MAX_REMOTE_HOPS + 5)).toBe(0);
  });

  it("matches hand-computed values from the keeper source rate (4000/300) and the flat killer/miner costs", () => {
    // Independently derived outside the module (see conversation) from SOURCE_ENERGY_KEEPER_CAPACITY=4000,
    // ENERGY_REGEN_TIME=300, the 7W/1C/3M keeper miner (7*HARVEST_POWER=14 >= 13.33/tick — the normal
    // remote miner's 6 WORK falls short of a keeper source's regen rate), and the 5T/10RA/5H/20M killer
    // body (3800 energy).
    expect(KEEPER_POTENTIAL_TABLE[0]).toBeCloseTo(28.514, 2);
    expect(KEEPER_POTENTIAL_TABLE[1]).toBeCloseTo(22.964, 2);
    expect(KEEPER_POTENTIAL_TABLE[2]).toBeCloseTo(17.514, 2);
    expect(KEEPER_POTENTIAL_TABLE[3]).toBeCloseTo(12.064, 2);
  });

  it("the keeper miner (7 WORK) saturates the source's real regen rate — the normal remote miner (6 WORK) would not", () => {
    const HARVEST_POWER = 2;
    const keeperSourceGross = 4000 / 300;
    expect(7 * HARVEST_POWER).toBeGreaterThanOrEqual(keeperSourceGross);
    expect(6 * HARVEST_POWER).toBeLessThan(keeperSourceGross);
  });
});
