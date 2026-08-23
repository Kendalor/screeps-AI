import { describe, expect, it } from "vitest";
import { boostActionFor } from "../../../src/empire/boostActions";

describe("boostActionFor", () => {
  it("resolves heal to the heal body part and its three tiers, ranked by multiplier", () => {
    const result = boostActionFor("heal");
    expect(result).toEqual({
      kind: "found",
      bodyPart: HEAL,
      T1: RESOURCE_LEMERGIUM_OXIDE, // LO, multiplier 2
      T2: RESOURCE_LEMERGIUM_ALKALIDE, // LHO2, multiplier 3
      T3: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE // XLHO2, multiplier 4
    });
  });

  it("resolves tough to the tough body part and its three tiers", () => {
    // tough's multiplier is a damage-taken REDUCTION (lower is better: 0.7/0.5/0.3), so tier ranking
    // must invert the usual "higher multiplier wins" rule for this one body part.
    const result = boostActionFor("tough");
    expect(result).toEqual({
      kind: "found",
      bodyPart: TOUGH,
      T1: RESOURCE_GHODIUM_OXIDE, // GO, damage 0.7 (least reduction = weakest tier)
      T2: RESOURCE_GHODIUM_ALKALIDE, // GHO2, damage 0.5
      T3: RESOURCE_CATALYZED_GHODIUM_ALKALIDE // XGHO2, damage 0.3 (most reduction = strongest tier)
    });
  });

  it("resolves attack to the attack body part and its three tiers", () => {
    const result = boostActionFor("attack");
    expect(result).toEqual({
      kind: "found",
      bodyPart: ATTACK,
      T1: RESOURCE_UTRIUM_HYDRIDE,
      T2: RESOURCE_UTRIUM_ACID,
      T3: RESOURCE_CATALYZED_UTRIUM_ACID
    });
  });

  it("resolves rangedAttack (a ranged_attack-part action distinct from attack) to its own tiers", () => {
    const result = boostActionFor("rangedAttack");
    expect(result).toEqual({
      kind: "found",
      bodyPart: RANGED_ATTACK,
      T1: RESOURCE_KEANIUM_OXIDE,
      T2: RESOURCE_KEANIUM_ALKALIDE,
      T3: RESOURCE_CATALYZED_KEANIUM_ALKALIDE
    });
  });

  it("resolves upgradeController to the work body part, distinct from other work actions", () => {
    const result = boostActionFor("upgradeController");
    expect(result).toEqual({
      kind: "found",
      bodyPart: WORK,
      T1: RESOURCE_GHODIUM_HYDRIDE,
      T2: RESOURCE_GHODIUM_ACID,
      T3: RESOURCE_CATALYZED_GHODIUM_ACID
    });
  });

  it("resolves build and repair (same LH/LH2O/XLH2O compounds, different action key) independently", () => {
    const build = boostActionFor("build");
    const repair = boostActionFor("repair");
    expect(build).toEqual({
      kind: "found",
      bodyPart: WORK,
      T1: RESOURCE_LEMERGIUM_HYDRIDE,
      T2: RESOURCE_LEMERGIUM_ACID,
      T3: RESOURCE_CATALYZED_LEMERGIUM_ACID
    });
    expect(repair).toEqual(build);
  });

  it("resolves dismantle to the work body part", () => {
    const result = boostActionFor("dismantle");
    expect(result).toEqual({
      kind: "found",
      bodyPart: WORK,
      T1: RESOURCE_ZYNTHIUM_HYDRIDE,
      T2: RESOURCE_ZYNTHIUM_ACID,
      T3: RESOURCE_CATALYZED_ZYNTHIUM_ACID
    });
  });

  it("resolves harvest to the work body part", () => {
    const result = boostActionFor("harvest");
    expect(result).toEqual({
      kind: "found",
      bodyPart: WORK,
      T1: RESOURCE_UTRIUM_OXIDE,
      T2: RESOURCE_UTRIUM_ALKALIDE,
      T3: RESOURCE_CATALYZED_UTRIUM_ALKALIDE
    });
  });

  it("resolves carry (capacity action) to the carry body part, under both the engine key and the friendlier body-part-name alias", () => {
    const expected = {
      kind: "found",
      bodyPart: CARRY,
      T1: RESOURCE_KEANIUM_HYDRIDE,
      T2: RESOURCE_KEANIUM_ACID,
      T3: RESOURCE_CATALYZED_KEANIUM_ACID
    };
    expect(boostActionFor("capacity")).toEqual(expected);
    expect(boostActionFor("carry")).toEqual(expected);
  });

  it("resolves move (fatigue action) to the move body part, under both the engine key and the friendlier body-part-name alias", () => {
    const expected = {
      kind: "found",
      bodyPart: MOVE,
      T1: RESOURCE_ZYNTHIUM_OXIDE,
      T2: RESOURCE_ZYNTHIUM_ALKALIDE,
      T3: RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE
    };
    expect(boostActionFor("fatigue")).toEqual(expected);
    expect(boostActionFor("move")).toEqual(expected);
  });

  it("does NOT alias a multi-action body part's name (e.g. 'work') to any single action", () => {
    expect(boostActionFor("work")).toEqual({ kind: "not-found", action: "work" });
  });

  it("returns a clear not-found result for an unknown action name, rather than throwing or returning undefined-shaped data", () => {
    const result = boostActionFor("teleport");
    expect(result).toEqual({ kind: "not-found", action: "teleport" });
  });

  it("returns not-found for an empty string", () => {
    expect(boostActionFor("")).toEqual({ kind: "not-found", action: "" });
  });

  it("is memoized: repeated calls return equal results built from the same lazily-constructed index", () => {
    const first = boostActionFor("heal");
    const second = boostActionFor("heal");
    expect(first).toEqual(second);
  });
});
