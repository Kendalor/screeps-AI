import { describe, expect, it } from "vitest";
import { ROLES, roleDef } from "../../src/behaviors/roles";

describe("bootstrap body (ported Allrounder.getBody)", () => {
  const body = (energy: number) => ROLES.bootstrap.body(energy);

  // One MOVE per weight-part is needed for full road speed while loaded; anything
  // less and the creep spends its life crawling on the road.
  const weight = (b: BodyPartConstant[]) => b.filter(p => p === WORK || p === CARRY).length;
  const moves = (b: BodyPartConstant[]) => b.filter(p => p === MOVE).length;

  it("builds one full-speed set at the 250 floor", () => {
    expect(body(300)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(body(0)).toEqual([WORK, CARRY, MOVE, MOVE]);
  });

  it("keeps one MOVE per weight-part at every size (full road speed when loaded)", () => {
    for (const e of [300, 550, 800, 1000, 1200]) {
      expect(moves(body(e))).toBe(weight(body(e)));
    }
  });

  it("adds another set as energy grows", () => {
    expect(body(500)).toEqual([WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE, MOVE]);
  });

  // Spends the remainder between whole sets on fatigue-neutral CARRY+MOVE pairs
  // (up to 3 CARRY per WORK) instead of discarding it, for more energy per trip.
  it("spends the remainder between sets on CARRY+MOVE pairs", () => {
    expect(body(350)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE, MOVE]);
    expect(body(450)).toEqual([WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]);
  });

  it("prefers a whole extra set over more carry once one is affordable", () => {
    // WORK is the source bottleneck, so the second WORK beats more CARRY.
    expect(body(500).filter(p => p === WORK)).toHaveLength(2);
  });

  // Beyond the second set, the remainder is held rather than spent on more CARRY:
  // it goes toward reaching the next WORK, which is what raises throughput.
  it("repeats the whole set above 500, leaving the remainder unspent", () => {
    const set = [WORK, CARRY, MOVE, MOVE];
    expect(body(600)).toEqual([...set, ...set]);
    expect(body(700)).toEqual([...set, ...set]);
    expect(body(750)).toEqual([...set, ...set, ...set]);
  });

  it("never proposes a body the budget cannot pay for", () => {
    const cost = (b: BodyPartConstant[]) => b.reduce((s, p) => s + BODYPART_COST[p], 0);
    for (let e = 250; e <= 1400; e += 50) {
      expect(cost(body(e))).toBeLessThanOrEqual(e);
    }
  });

  it("caps the number of sets regardless of energy", () => {
    const capped = body(5000);
    expect(moves(capped)).toBe(weight(capped));
    expect(capped.filter(p => p === WORK)).toHaveLength(5);
    expect(body(10_000)).toEqual(capped);
  });
});

describe("upgrader body (ported Upgrader.getBody)", () => {
  const body = (energy: number) => ROLES.upgrader.body(energy);

  it("builds the minimal WORK/CARRY/MOVE base at the 300-energy floor", () => {
    expect(body(300)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
    expect(body(0)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
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

  // Unlike bootstrap, a builder withdraws a full load in one tick, so extra CARRY
  // between sets buys nothing the next whole set doesn't buy better.
  it("builds whole full-speed sets only, ignoring the remainder", () => {
    expect(ROLES.builder.body(300)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(ROLES.builder.body(450)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(ROLES.builder.body(550)).toEqual([WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE, MOVE]);
  });
});

// The miner's body depends on where it drops energy, not just room budget: standing
// on a container it needs no CARRY, but without one (or with a link) it must hold energy.
describe("miner body", () => {
  const body = (energy: number, over: Partial<Parameters<typeof ROLES.miner.body>[1]> = {}) =>
    ROLES.miner.body(energy, { hasContainer: false, hasLink: false, ...over });

  it("carries a CARRY part when there is no container to drop into", () => {
    expect(body(300)).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("drops the CARRY once there is a container to stand on", () => {
    expect(body(550, { hasContainer: true })).toEqual([WORK, WORK, WORK, WORK, WORK, MOVE]);
  });

  it("stops at the 5 WORK that saturate a source, however rich the room", () => {
    const rich = body(5000, { hasContainer: true });
    expect(rich.filter(p => p === WORK)).toHaveLength(5);
    expect(rich.filter(p => p === CARRY)).toHaveLength(0);
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
    expect(body(0)).toEqual([CARRY, CARRY, MOVE]);
  });

  it("adds a CARRY,CARRY,MOVE set per 150 energy", () => {
    expect(body(300)).toEqual([CARRY, CARRY, MOVE, CARRY, CARRY, MOVE]);
    expect(body(450)).toHaveLength(9);
    expect(body(440).filter(p => p === CARRY)).toHaveLength(4);
  });

  it("caps the body at the 50-part limit", () => {
    const capped = body(10_000);
    expect(capped.length).toBeLessThanOrEqual(50);
    expect(capped).toEqual(body(2400));
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

// Supply is the inverse of hauler: hauler moves energy from mining containers into
// storage, supply moves it back out to what must stay full for spawning to work.
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
