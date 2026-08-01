// colonizePotentialScore combines a candidate's map-topology potential (normal + keeper energy value)
// with a flat bonus per mineral type the empire doesn't already have — doubled for the candidate's own
// room mineral. Pure — no Game.*, no Memory.

import { describe, expect, it } from "vitest";
import { colonizePotentialScore, NEW_MINERAL_BONUS } from "../../../src/mining/colonizePotentialScore";
import type { ColonizationPotential } from "../../../src/memory/schema";

const potential = (over: Partial<ColonizationPotential> = {}): ColonizationPotential => ({
  normal: 10,
  keeper: 0,
  keeperMinerals: [],
  ...over
});

describe("colonizePotentialScore", () => {
  it("is just normal+keeper potential with no minerals involved", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10, keeper: 5 }),
      haveMinerals: new Set()
    });
    expect(score).toBe(15);
  });

  it("adds a flat bonus for a new mineral in a neighboring keeper room", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10, keeperMinerals: ["X" as MineralConstant] }),
      haveMinerals: new Set()
    });
    expect(score).toBe(10 + NEW_MINERAL_BONUS);
  });

  it("does not bonus a mineral the empire already has", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10, keeperMinerals: ["X" as MineralConstant] }),
      haveMinerals: new Set(["X" as MineralConstant])
    });
    expect(score).toBe(10);
  });

  it("doubles the bonus for the candidate's own room mineral", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10 }),
      ownMineral: "X" as MineralConstant,
      haveMinerals: new Set()
    });
    expect(score).toBe(10 + NEW_MINERAL_BONUS * 2);
  });

  it("does not bonus the own-room mineral if the empire already has it", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10 }),
      ownMineral: "X" as MineralConstant,
      haveMinerals: new Set(["X" as MineralConstant])
    });
    expect(score).toBe(10);
  });

  it("sums bonuses across the own mineral and multiple distinct keeper minerals", () => {
    const score = colonizePotentialScore({
      potential: potential({ normal: 10, keeperMinerals: ["Y" as MineralConstant, "Z" as MineralConstant] }),
      ownMineral: "X" as MineralConstant,
      haveMinerals: new Set()
    });
    expect(score).toBe(10 + NEW_MINERAL_BONUS * 2 + NEW_MINERAL_BONUS * 2);
  });
});
