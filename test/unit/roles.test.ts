import { describe, expect, it } from "vitest";
import { ROLES, roleDef } from "../../src/behaviors/roles";

describe("bootstrap body (ported Allrounder.getBody)", () => {
  const body = (energy: number) => ROLES.bootstrap.body(energy);

  // The move ratio, not the WORK count, is what makes an allrounder useful: a
  // creep carrying energy generates 2 fatigue per WORK/CARRY part and clears 2
  // per MOVE, so anything short of one MOVE per weight-part crawls (a
  // [WORK,CARRY,MOVE] creep moves 1 tile every 2 ticks when loaded, spending its
  // life on the road). The body is [WORK,CARRY,MOVE,MOVE] sets — full road speed
  // loaded — sized to the energy budget.
  const weight = (b: BodyPartConstant[]) => b.filter(p => p === WORK || p === CARRY).length;
  const moves = (b: BodyPartConstant[]) => b.filter(p => p === MOVE).length;

  it("builds one full-speed set at the 250 floor", () => {
    expect(body(300)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(body(0)).toEqual([WORK, CARRY, MOVE, MOVE]); // never below the floor
  });

  it("keeps one MOVE per weight-part at every size (full road speed when loaded)", () => {
    for (const e of [300, 550, 800, 1000, 1200]) {
      expect(moves(body(e))).toBe(weight(body(e)));
    }
  });

  it("adds another set as energy grows", () => {
    // 500 buys a second [WORK,CARRY,MOVE,MOVE] set.
    expect(body(500)).toEqual([WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE, MOVE]);
  });

  // The gap between whole sets is 250 energy — two extensions' worth of growth
  // that the old formula threw away entirely, so a 450-capacity room spawned the
  // same runt as a 250-capacity one. Spend the remainder on CARRY+MOVE pairs
  // (100 each, fatigue-neutral) up to 3 CARRY per WORK: more energy per trip
  // from the same harvest rate, which is what an allrounder walking to the
  // controller is limited by.
  it("spends the remainder between sets on CARRY+MOVE pairs", () => {
    expect(body(350)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE, MOVE]);
    expect(body(450)).toEqual([WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]);
  });

  it("prefers a whole extra set over more carry once one is affordable", () => {
    // 500 buys the 2-WORK body rather than 1 WORK with 4 CARRY: at the source
    // WORK is the bottleneck, so the second WORK is worth more than the carry.
    expect(body(500).filter(p => p === WORK)).toHaveLength(2);
  });

  // Above the second set the body is pure repetition of the 250 set and the
  // remainder is held, not spent: a bootstrap fills at 2 energy/tick per WORK,
  // so past the set's own 1 CARRY per WORK it would stand at the source longer
  // than the extra load saves it. Holding the remainder is how it reaches the
  // next WORK, which is the part that actually raises throughput.
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
    expect(moves(capped)).toBe(weight(capped)); // still balanced
    expect(capped.filter(p => p === WORK)).toHaveLength(5); // 5-set cap
    expect(body(10_000)).toEqual(capped); // no growth past the cap
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

  // Builder keeps the plain whole-set formula (ported Builder.getBody). The
  // bootstrap rungs between sets are tuned for a creep that harvests its own
  // energy; a builder withdraws a full load from storage in one tick, so extra
  // CARRY buys it nothing the next set does not buy better.
  it("builds whole full-speed sets only, ignoring the remainder", () => {
    expect(ROLES.builder.body(300)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(ROLES.builder.body(450)).toEqual([WORK, CARRY, MOVE, MOVE]);
    expect(ROLES.builder.body(550)).toEqual([WORK, CARRY, MOVE, MOVE, WORK, CARRY, MOVE, MOVE]);
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
