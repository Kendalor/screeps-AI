import { describe, expect, it } from "vitest";
import { computeBoostNeeds } from "../../../src/empire/boostNeeds";

describe("computeBoostNeeds", () => {
  it("returns an empty map for an empty boostable list", () => {
    const needs = computeBoostNeeds([], [WORK, CARRY, MOVE], 3);
    expect(needs).toEqual({});
  });

  it("scales a single action's compound amount by the actual part count in the body, not a flat constant", () => {
    const body: BodyPartConstant[] = [TOUGH, TOUGH, TOUGH, MOVE, MOVE];
    const needs = computeBoostNeeds(["tough"], body, 1);
    // tough -> T1 is GO per the real BOOSTS table (node_modules/@screeps/common/lib/constants.js).
    expect(needs).toEqual({ GO: 30 * 3 }); // LAB_BOOST_MINERAL * partCount
  });

  it("sums multiple distinct actions/compounds independently", () => {
    const body: BodyPartConstant[] = [HEAL, HEAL, TOUGH, MOVE];
    const needs = computeBoostNeeds(["heal", "tough"], body, 2);
    expect(needs).toEqual({
      LHO2: 30 * 2, // heal T2
      GHO2: 30 * 1 // tough T2
    });
  });

  it("contributes nothing for a boostable action whose body part is absent from the given body", () => {
    const body: BodyPartConstant[] = [MOVE, MOVE, CARRY];
    const needs = computeBoostNeeds(["heal", "tough"], body, 1);
    expect(needs).toEqual({});
  });

  it("ignores an unknown/not-found action name rather than throwing", () => {
    const body: BodyPartConstant[] = [WORK, WORK];
    const needs = computeBoostNeeds(["not-a-real-action"], body, 1);
    expect(needs).toEqual({});
  });
});
