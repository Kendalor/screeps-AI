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

// The miner's body depends on where it drops energy, not just on how much the
// room can spend: standing on a container it needs no CARRY at all, but with
// no container (early) or a link (late) it must hold energy to hand off.
describe("miner body", () => {
  const body = (energy: number, over: Partial<Parameters<typeof ROLES.miner.body>[1]> = {}) =>
    ROLES.miner.body(energy, { hasContainer: false, hasLink: false, ...over });

  it("carries a CARRY part when there is no container to drop into", () => {
    // 300 is a compromise: a 1-WORK miner would not be worth the spawn.
    expect(body(300)).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("drops the CARRY once there is a container to stand on", () => {
    // 550 buys 5 WORK + 1 MOVE: overflow falls into the container underneath.
    expect(body(550, { hasContainer: true })).toEqual([WORK, WORK, WORK, WORK, WORK, MOVE]);
  });

  it("stops at the 5 WORK that saturate a source, however rich the room", () => {
    const rich = body(5000, { hasContainer: true });
    expect(rich.filter(p => p === WORK)).toHaveLength(5);
    expect(rich.filter(p => p === CARRY)).toHaveLength(0);
    // Spare energy past the WORK cap buys the full 1:2 MOVE ratio — a parked
    // miner still has to reach its source, and nothing else is worth buying.
    expect(rich.filter(p => p === MOVE)).toHaveLength(3);
  });

  it("takes a CARRY back when it has to feed a link", () => {
    const linked = body(800, { hasContainer: true, hasLink: true });
    expect(linked.filter(p => p === WORK)).toHaveLength(5);
    expect(linked.filter(p => p === CARRY)).toHaveLength(1);
  });
});

describe("hauler body (ported HaulerOperation carry-parts math)", () => {
  const body = (energy: number) => ROLES.hauler.body(energy);

  it("builds a single CARRY,CARRY,MOVE set at the 150-energy floor", () => {
    expect(body(150)).toEqual([CARRY, CARRY, MOVE]);
    expect(body(0)).toEqual([CARRY, CARRY, MOVE]); // never below one set
  });

  it("adds a CARRY,CARRY,MOVE set per 150 energy", () => {
    expect(body(300)).toEqual([CARRY, CARRY, MOVE, CARRY, CARRY, MOVE]);
    expect(body(450)).toHaveLength(9);
    expect(body(440).filter(p => p === CARRY)).toHaveLength(4); // rounds down
  });

  it("caps the body at the 50-part limit", () => {
    const capped = body(10_000);
    expect(capped.length).toBeLessThanOrEqual(50);
    expect(capped).toEqual(body(2400)); // 16 sets = 48 parts, the last that fits
  });
});

describe("miner role", () => {
  it("harvests, then prefers a link over a container to deposit into", () => {
    expect(roleDef("miner")).toEqual({
      body: ROLES.miner.body,
      steps: [
        { do: "harvest", from: { find: "source" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
      ]
    });
  });
});

describe("hauler role", () => {
  it("withdraws from a container, then fills storage before falling back to spawn", () => {
    expect(roleDef("hauler")).toEqual({
      body: ROLES.hauler.body,
      steps: [
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
      ]
    });
  });
});

// Supply is the inverse of hauler: hauler moves energy from mining containers
// INTO storage, supply moves it back OUT to the things that must be kept full
// for spawning to work. Old SupplyExtension/SupplySpawn collapse into this one
// row (docs/rewrite-skeleton.md §5).
describe("supply role", () => {
  it("withdraws from storage, then fills extensions before the spawn", () => {
    expect(roleDef("supply")).toEqual({
      body: ROLES.supply.body,
      steps: [
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
        { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
        { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
      ]
    });
  });

  it("shares the hauler carry-parts body — it is the same job in reverse", () => {
    expect(ROLES.supply.body(150)).toEqual([CARRY, CARRY, MOVE]);
    expect(ROLES.supply.body(450)).toEqual(ROLES.hauler.body(450));
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
