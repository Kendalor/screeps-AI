import { describe, expect, it } from "vitest";
import { affordableSets, bodyCost, countPart, orderBody, parts } from "../../src/spawn/body";

describe("bodyCost", () => {
  it("sums the game's BODYPART_COST table", () => {
    expect(bodyCost([WORK, CARRY, MOVE, MOVE])).toBe(250);
    expect(bodyCost([CARRY, CARRY, MOVE])).toBe(150);
    expect(bodyCost([WORK, CARRY, CARRY, MOVE, MOVE])).toBe(300);
    expect(bodyCost([CARRY, MOVE])).toBe(100);
  });

  it("is zero for an empty body", () => {
    expect(bodyCost([])).toBe(0);
  });
});

describe("affordableSets", () => {
  const set = [WORK, CARRY, MOVE, MOVE]; // 250

  it("divides the budget by the set's derived cost", () => {
    expect(affordableSets(250, set, 1, 5)).toBe(1);
    expect(affordableSets(499, set, 1, 5)).toBe(1);
    expect(affordableSets(500, set, 1, 5)).toBe(2);
  });

  it("clamps to the given bounds", () => {
    expect(affordableSets(0, set, 1, 5)).toBe(1);
    expect(affordableSets(10_000, set, 1, 5)).toBe(5);
  });

  it("tracks the set's parts rather than a hardcoded price", () => {
    expect(affordableSets(600, [CARRY, CARRY, MOVE], 1, 16)).toBe(4);
  });
});

// Screeps consumes body parts front-to-back on hit; ordering by ascending importance
// keeps the most useful parts alive longest.
describe("orderBody", () => {
  it("puts MOVE last and TOUGH first", () => {
    expect(orderBody([MOVE, WORK, TOUGH])).toEqual([TOUGH, WORK, MOVE]);
  });

  it("orders the full priority chain TOUGH -> ... -> ATTACK -> HEAL -> MOVE", () => {
    const shuffled = [MOVE, HEAL, ATTACK, TOUGH, WORK, CARRY, RANGED_ATTACK, CLAIM];
    expect(orderBody(shuffled)).toEqual([TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE]);
  });

  it("keeps every part — reordering only, never adding or dropping", () => {
    const body = [WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE];
    const ordered = orderBody(body);
    expect(ordered).toHaveLength(body.length);
    expect(bodyCost(ordered)).toBe(bodyCost(body));
    for (const part of [WORK, CARRY, MOVE]) {
      expect(countPart(ordered, part)).toBe(countPart(body, part));
    }
  });

  it("groups all parts of a kind together", () => {
    const ordered = orderBody([WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE, MOVE]);
    expect(ordered).toEqual([WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]);
  });

  it("does not mutate its argument", () => {
    const body = [MOVE, WORK];
    orderBody(body);
    expect(body).toEqual([MOVE, WORK]);
  });

  it("handles an empty body", () => {
    expect(orderBody([])).toEqual([]);
  });
});

describe("body assembly helpers", () => {
  it("counts parts", () => {
    expect(countPart([WORK, CARRY, MOVE, MOVE], MOVE)).toBe(2);
    expect(countPart([WORK, CARRY, MOVE, MOVE], TOUGH)).toBe(0);
  });

  it("builds n copies of a part, never negative", () => {
    expect(parts(MOVE, 3)).toEqual([MOVE, MOVE, MOVE]);
    expect(parts(MOVE, 0)).toEqual([]);
    expect(parts(MOVE, -1)).toEqual([]);
  });
});
