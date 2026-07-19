import { describe, expect, it } from "vitest";
import { ROLES } from "../../src/behaviors/roles";

describe("bootstrap body (ported Allrounder.getBody)", () => {
  const body = (energy: number) => ROLES.bootstrap.body(energy);

  it("builds one work set at the 300-energy floor", () => {
    expect(body(300)).toEqual([WORK, CARRY, MOVE]);
    expect(body(0)).toEqual([WORK, CARRY, MOVE]); // never below the floor
  });

  it("adds a move/carry pair when leftover energy exceeds 100", () => {
    // 550: two 200-sets leave 150 spare -> leading MOVE,CARRY
    expect(body(550)).toEqual([MOVE, CARRY, WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
  });

  it("caps at four work sets regardless of energy", () => {
    const capped = body(5000);
    expect(capped).toEqual(body(1200));
    expect(capped.filter(p => p === WORK)).toHaveLength(4);
  });
});
