import { describe, expect, it } from "vitest";
import { ROLES, roleDef } from "../../src/behaviors/roles";

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

describe("upgrader body (ported Upgrader.getBody)", () => {
  const body = (energy: number) => ROLES.upgrader.body(energy);

  it("builds the minimal WORK/CARRY/MOVE base at the 300-energy floor", () => {
    expect(body(300)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
    expect(body(0)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]); // never below the floor
  });

  it("adds WORK,WORK,MOVE sets (2 WORK : 1 MOVE) as energy grows", () => {
    expect(body(550)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE, WORK, WORK, MOVE]);
  });
});

describe("builder role", () => {
  it("resolves via roleDef and gathers from storage/container, falling back to harvest, before building", () => {
    expect(roleDef("builder")).toEqual({
      body: ROLES.builder.body,
      steps: [
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
        { do: "harvest", from: { find: "source" } },
        { do: "build" }
      ]
    });
  });

  it("shares the bootstrap body formula (ported Builder.getBody — same WORK/CARRY/MOVE sets)", () => {
    expect(ROLES.builder.body(300)).toEqual([WORK, CARRY, MOVE]);
    expect(ROLES.builder.body(550)).toEqual(ROLES.bootstrap.body(550));
  });
});

describe("upgrader role", () => {
  it("resolves via roleDef and withdraws from link/storage before upgrading", () => {
    expect(roleDef("upgrader")).toEqual({
      body: ROLES.upgrader.body,
      steps: [
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
        { do: "upgrade" }
      ]
    });
  });
});
