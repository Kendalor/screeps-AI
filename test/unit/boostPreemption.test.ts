import { describe, expect, it } from "vitest";
import { runCreepBehaviors } from "../../src/empire/creeps";
import { stubGame } from "../helpers";

// gh #75 (epic #61) rewritten per docs/boosting-lab-runner-design.md section 5: boostPreemption no longer
// receives a per-creep Map<Id<Creep>, BoostLabAssignment> — it self-discovers a lab by scanning the
// colony's boostLabIds directly for one already stocked with a compound the creep still needs, in
// sufficient amount (LAB_BOOST_MINERAL * matching part count). Mirrors fleeThreat/retreatIfDisarmed's
// placement in runOne (see interpreter.ts/creeps.ts), gated first on the cheap static Role.boostable
// check (a non-boostable role never enters the routine regardless of memory), then on creep.memory.boosts
// being non-empty. Driven through the public runCreepBehaviors entry point, same convention as
// fleeThreat.test.ts/retreatIfDisarmed.test.ts, so these survive refactors of the dispatch internals.
//
// Task D (docs/boosting-lab-runner-design.md, "who calls what: LabRunner") widened runCreepBehaviors'
// second parameter from a single flat `boostLabIds` array to `boostLabIdsByHome: Map<string, readonly
// Id<StructureLab>[]>`, keyed by creep.memory.home — the same per-colony keying transportCreepsByHome
// already uses — since each colony reserves its OWN 3 boost labs and a creep must never be handed a
// sibling colony's lab ids. Every call below wraps its labs in `new Map([["W1N1", [...]]])` accordingly
// (every fixture creep in this file has home "W1N1"); the dedicated cross-colony test at the bottom of
// this file confirms the per-home lookup actually isolates two colonies from each other.
//
// simpleHealer is the one real role with a non-empty Role.boostable (["heal", "tough"]) today, so it's
// used as the boostable fixture throughout; "builder" (empty boostable) is the non-boostable fixture.
// "heal"'s T1/T2/T3 compounds come from the real BOOSTS table (test/constants.ts's stubbed copy):
// LO(T1) -> LHO2(T2) -> XLHO2(T3). Only T3 (RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE) is used below as the
// stand-in "the creep's wanted compound" — which exact tier doesn't matter to these tests since
// lab-discovery accepts ANY of the action's T1/T2/T3 compounds as a match (spec section "which tier").
// RESOURCE_UTRIUM (a plain, never-a-heal-compound mineral) is used as the "unrelated compound" a lab
// might be stocked with instead.

const LAB_1 = "lab1" as Id<StructureLab>;
const LAB_2 = "lab2" as Id<StructureLab>;
const LAB_3 = "lab3" as Id<StructureLab>;

// heal's real T3 compound (BOOSTS.heal.XLHO2, test/constants.ts's stubbed table) — LO(T1)/LHO2(T2)/XLHO2(T3).
const HEAL_T3_COMPOUND = RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE;
const UNRELATED_COMPOUND = RESOURCE_UTRIUM; // never a heal compound

interface LabStub {
  id: Id<StructureLab>;
  pos: { x: number; y: number; roomName: string; inRangeTo: (p: { x: number; y: number }, range: number) => boolean };
  mineralType: ResourceConstant | null;
  mineralAmount: number;
  boostCreep: (c: Creep) => ScreepsReturnCode;
}

function labStub(opts: {
  id: Id<StructureLab>;
  pos: { x: number; y: number };
  mineralType?: ResourceConstant | null;
  mineralAmount?: number;
  boostCreepResult?: ScreepsReturnCode;
  boostCreepCalls?: string[];
}): LabStub {
  const { x, y } = opts.pos;
  return {
    id: opts.id,
    pos: {
      x,
      y,
      roomName: "W1N1",
      inRangeTo: (p: { x: number; y: number }, range: number) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= range
    },
    mineralType: opts.mineralType ?? null,
    mineralAmount: opts.mineralAmount ?? 0,
    boostCreep: (c: Creep) => {
      opts.boostCreepCalls?.push(c.id);
      return opts.boostCreepResult ?? OK;
    }
  };
}

function boostableCreep(opts: {
  boosts?: string[];
  pos?: { x: number; y: number };
  body?: { type: BodyPartConstant; hits: number; boost?: ResourceConstant }[]; // overrides the default single-HEAL-part body
}): { creep: Creep; traveled: { x: number; y: number }[] } {
  const traveled: { x: number; y: number }[] = [];
  const px = opts.pos?.x ?? 5;
  const py = opts.pos?.y ?? 5;

  const body = opts.body ?? [{ type: HEAL, hits: 100 }];
  const healPartCount = body.filter(p => p.type === HEAL).length;

  const creep = {
    id: "h1",
    name: "h1",
    spawning: false,
    memory: { role: "simpleHealer", task: { step: 0 }, home: "W1N1", boosts: opts.boosts },
    store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
    body,
    hits: 100,
    hitsMax: 100,
    pos: {
      x: px,
      y: py,
      roomName: "W1N1",
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(px - p.x), Math.abs(py - p.y)),
      // Accepts either a raw {x,y} position or a HasPos-shaped object ({pos: {x,y}}) — actOnResolved
      // calls creep.pos.inRangeTo(target, range) with the target OBJECT (e.g. a lab), not target.pos,
      // matching the real RoomPosition.inRangeTo signature (RoomPosition | RoomObject).
      inRangeTo: (p: { x?: number; y?: number; pos?: { x: number; y: number } }, range: number) => {
        const qx = p.pos?.x ?? p.x!;
        const qy = p.pos?.y ?? p.y!;
        return Math.max(Math.abs(px - qx), Math.abs(py - qy)) <= range;
      },
      isEqualTo: (p: { x: number; y: number }) => px === p.x && py === p.y,
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room: {
      name: "W1N1",
      find: () => []
    },
    getActiveBodyparts: (part: BodyPartConstant) => (part === HEAL ? healPartCount : 0),
    // Accepts either a raw {x,y} position or a HasPos-shaped object ({pos: {x,y}}) — actOnResolved
    // (behaviors/actions.ts) calls travelTo with the target object itself, matching the real
    // Creep.travelTo/Traveler signature (RoomPosition | {pos: RoomPosition}), not just a bare position.
    travelTo: (p: { x?: number; y?: number; pos?: { x: number; y: number } }) =>
      traveled.push(p.pos ? { x: p.pos.x, y: p.pos.y } : { x: p.x!, y: p.y! }),
    heal: () => OK
  } as unknown as Creep;

  return { creep, traveled };
}

describe("boost pre-emption: non-boostable role", () => {
  it("never enters the boost routine, even carrying a boosts order in memory", () => {
    stubGame({ objects: {} });
    const traveled: { x: number; y: number }[] = [];
    const creep = {
      name: "b1",
      spawning: false,
      // "builder" has an empty Role.boostable — this memory field should simply be ignored.
      memory: { role: "builder", task: { step: 0 }, home: "W1N1", boosts: ["heal"] },
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
      pos: {
        x: 5,
        y: 5,
        roomName: "W1N1",
        findClosestByPath: (list: object[]) => list[0] ?? null,
        inRangeTo: () => true
      },
      room: { find: () => [] },
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y }),
      getActiveBodyparts: (part: BodyPartConstant) => (part === WORK ? 1 : 0)
    } as unknown as Creep;
    Game.creeps = { b1: creep };

    expect(() => runCreepBehaviors()).not.toThrow();
    // Ordinary step table ran (builder idled — no sites/energy — parkNearBunker may or may not travel,
    // but crucially the boost routine (which would scan boostLabIds) never fired).
    expect(creep.memory.boosts).toEqual(["heal"]); // untouched — boost routine never even looked at it
  });
});

describe("boost pre-emption: boostable role, no pending order", () => {
  it("runs its normal step table unaffected", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = boostableCreep({ boosts: undefined });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", []]]));

    // healerAdvance step ran (no followFlag set -> falls back to moveToRoom(targetRoom), which is a
    // no-op with no targetRoom set) — the point is nothing about the boost routine fired: no travel
    // toward any lab position, memory.boosts stays undefined.
    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toBeUndefined();
  });

  it("also runs normally when boosts is present but empty", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = boostableCreep({ boosts: [] });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", []]]));

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual([]);
  });
});

describe("boost pre-emption: self-discovery among boostLabIds", () => {
  it("walks toward a lab already stocked with a matching compound in sufficient amount, when not yet adjacent", () => {
    const lab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 }, // out of range 1 of the creep at (3,5)
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL * 1 // exactly enough for 1 HEAL part
    });
    stubGame({ objects: { [LAB_1]: lab } });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 3, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]));

    // Moved toward the lab, not toward healerAdvance's flag-following/heal targets.
    expect(traveled.length).toBe(1);
    expect(traveled[0]).toEqual(expect.objectContaining({ x: 6, y: 5 }));
  });

  it("calls boostCreep once adjacent to the discovered lab, without moving further", () => {
    const boostCreepCalls: string[] = [];
    const lab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 }, // range 1 of the creep at (5,5) — adjacent
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls
    });
    stubGame({ objects: { [LAB_1]: lab } });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]));

    expect(boostCreepCalls).toEqual(["h1"]);
    expect(traveled).toEqual([]);
  });

  it("finds and uses the correct lab among several, ignoring empty/unrelated-stock siblings", () => {
    const boostCreepCalls: string[] = [];
    const emptyLab = labStub({ id: LAB_1, pos: { x: 10, y: 10 }, mineralType: null, mineralAmount: 0 });
    const unrelatedLab = labStub({ id: LAB_2, pos: { x: 11, y: 11 }, mineralType: UNRELATED_COMPOUND, mineralAmount: 1000 });
    const stockedLab = labStub({
      id: LAB_3,
      pos: { x: 5, y: 5 }, // adjacent to the creep at (5,5)? no, exactly on it -> range 0, still range 1 ok
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls
    });
    stubGame({ objects: { [LAB_1]: emptyLab, [LAB_2]: unrelatedLab, [LAB_3]: stockedLab } });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1, LAB_2, LAB_3]]]));

    expect(boostCreepCalls).toEqual(["h1"]);
    expect(traveled).toEqual([]);
  });

  it("does nothing this tick when no lab in boostLabIds is stocked with a matching compound", () => {
    const emptyLab = labStub({ id: LAB_1, pos: { x: 6, y: 5 }, mineralType: null, mineralAmount: 0 });
    const unrelatedLab = labStub({ id: LAB_2, pos: { x: 7, y: 5 }, mineralType: UNRELATED_COMPOUND, mineralAmount: 1000 });
    stubGame({ objects: { [LAB_1]: emptyLab, [LAB_2]: unrelatedLab } });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1, LAB_2]]]));

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual(["heal"]); // stays pending, retried next tick
  });

  it("treats a matching-type-but-insufficient-amount lab as not-a-match, same as no match", () => {
    const shortLab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 },
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL - 1 // one short of enough for 1 HEAL part
    });
    stubGame({ objects: { [LAB_1]: shortLab } });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]));

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual(["heal"]);
  });

  it("leaves the order pending (not cleared, not thrown) when boostCreep returns a non-OK code", () => {
    const boostCreepCalls: string[] = [];
    const lab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 },
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls,
      boostCreepResult: ERR_NOT_ENOUGH_RESOURCES
    });
    stubGame({ objects: { [LAB_1]: lab } });
    const { creep } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    expect(() => runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]))).not.toThrow();

    expect(boostCreepCalls).toEqual(["h1"]);
    expect(creep.memory.boosts).toEqual(["heal"]); // still pending -- the failed call satisfied nothing
  });
});

describe("boost pre-emption: no boostLabIds supplied", () => {
  it("waits rather than acting when boostLabIds is empty", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", []]]));

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual(["heal"]);
  });

  it("defaults to no boostLabIds when the parameter is omitted entirely", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = boostableCreep({ boosts: ["heal"], pos: { x: 5, y: 5 } });
    Game.creeps = { h1: creep };

    expect(() => runCreepBehaviors()).not.toThrow();

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual(["heal"]);
  });
});

describe("boost pre-emption: order cleared once satisfied", () => {
  it("clears memory.boosts once the creep's body already carries the boost, resuming normal dispatch", () => {
    const boostCreepCalls: string[] = [];
    const lab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 },
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls
    });
    stubGame({ objects: { [LAB_1]: lab } });
    const { creep } = boostableCreep({
      boosts: ["heal"],
      pos: { x: 5, y: 5 },
      body: [{ type: HEAL, hits: 100, boost: HEAL_T3_COMPOUND }] // already carries the boost
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]));

    expect(boostCreepCalls).toEqual([]); // never called boostCreep — already satisfied
    expect(creep.memory.boosts).toBeUndefined(); // order cleared
  });

  it("falls through to ordinary step-table behavior on the next tick once cleared", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = boostableCreep({ boosts: undefined });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", []]]));

    // Falls through to healerAdvance's own no-op (no followFlag/targetRoom) rather than the boost routine.
    expect(traveled).toEqual([]);
  });

  it("does NOT clear the order when only SOME of a multi-part body's matching parts are boosted", () => {
    // 3 HEAL parts, only 1 carries a boost -- a real engine boostCreep() call can boost fewer than every
    // matching part when the lab's compound falls short of the full count. Satisfaction must require every
    // matching part, not just one, or the remaining unboosted parts get abandoned with no retry.
    const boostCreepCalls: string[] = [];
    const lab = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 },
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL * 3, // enough for all 3 parts
      boostCreepCalls
    });
    stubGame({ objects: { [LAB_1]: lab } });
    const { creep } = boostableCreep({
      boosts: ["heal"],
      pos: { x: 5, y: 5 },
      body: [
        { type: HEAL, hits: 100, boost: HEAL_T3_COMPOUND },
        { type: HEAL, hits: 100 },
        { type: HEAL, hits: 100 }
      ]
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map([["W1N1", [LAB_1]]]));

    expect(creep.memory.boosts).toEqual(["heal"]); // still pending -- 2 of 3 parts remain unboosted
    expect(boostCreepCalls).toEqual(["h1"]); // retried this tick, since the order isn't satisfied yet
  });
});

// Task D's own addition: confirms the per-colony keying (boostLabIdsByHome, keyed by creep.memory.home,
// the exact precedent transportCreepsByHome already sets) actually isolates two colonies' reserved boost
// labs from each other — a creep spawned by colony A must never even look at colony B's lab ids, per
// docs/boosting-lab-runner-design.md's "who calls what: LabRunner" section.
function boostableCreepInHome(home: string, name: string, boosts: string[] | undefined): { creep: Creep; traveled: { x: number; y: number }[] } {
  const traveled: { x: number; y: number }[] = [];
  const px = 5;
  const py = 5;
  const body = [{ type: HEAL, hits: 100 }];
  const creep = {
    id: name,
    name,
    spawning: false,
    memory: { role: "simpleHealer", task: { step: 0 }, home, boosts },
    store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
    body,
    hits: 100,
    hitsMax: 100,
    pos: {
      x: px,
      y: py,
      roomName: home,
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(px - p.x), Math.abs(py - p.y)),
      inRangeTo: (p: { x?: number; y?: number; pos?: { x: number; y: number } }, range: number) => {
        const qx = p.pos?.x ?? p.x!;
        const qy = p.pos?.y ?? p.y!;
        return Math.max(Math.abs(px - qx), Math.abs(py - qy)) <= range;
      },
      isEqualTo: (p: { x: number; y: number }) => px === p.x && py === p.y,
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room: { name: home, find: () => [] },
    getActiveBodyparts: (part: BodyPartConstant) => (part === HEAL ? 1 : 0),
    travelTo: (p: { x?: number; y?: number; pos?: { x: number; y: number } }) =>
      traveled.push(p.pos ? { x: p.pos.x, y: p.pos.y } : { x: p.x!, y: p.y! }),
    heal: () => OK
  } as unknown as Creep;
  return { creep, traveled };
}

describe("boost pre-emption: per-colony boostLabIdsByHome isolation", () => {
  it("never lets a creep from colony A see colony B's boostLabIds, even when both are passed in the same map", () => {
    // LAB_A is stocked and reachable (adjacent, range 1) only under colony A's own key; LAB_B (colony B's
    // lab) is stocked with the SAME compound at the SAME position, but must never be consulted by colony
    // A's creep since it isn't listed under "roomA" in the map (and vice versa for colony B's creep).
    const boostCreepCallsA: string[] = [];
    const boostCreepCallsB: string[] = [];
    const labA = labStub({
      id: LAB_1,
      pos: { x: 6, y: 5 }, // adjacent to the creep at (5,5) -- range 1, boosts immediately, no travel
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls: boostCreepCallsA
    });
    const labB = labStub({
      id: LAB_2,
      pos: { x: 6, y: 5 },
      mineralType: HEAL_T3_COMPOUND,
      mineralAmount: LAB_BOOST_MINERAL,
      boostCreepCalls: boostCreepCallsB
    });
    stubGame({ objects: { [LAB_1]: labA, [LAB_2]: labB } });

    const { creep: creepA } = boostableCreepInHome("roomA", "a1", ["heal"]);
    const { creep: creepB } = boostableCreepInHome("roomB", "b1", ["heal"]);
    Game.creeps = { a1: creepA, b1: creepB };

    const boostLabIdsByHome = new Map<string, readonly Id<StructureLab>[]>([
      ["roomA", [LAB_1]],
      ["roomB", [LAB_2]]
    ]);

    runCreepBehaviors(undefined, boostLabIdsByHome);

    // Each creep boosted at its OWN colony's lab only (LAB_1 called with a1, LAB_2 called with b1) — a
    // shared/flattened map (or a lookup bug swapping the two) would instead show a1 calling LAB_2 or b1
    // calling LAB_1, or one creep silently satisfying itself off the other colony's stock.
    expect(boostCreepCallsA).toEqual(["a1"]);
    expect(boostCreepCallsB).toEqual(["b1"]);
  });

  it("gives a creep from a home room with no entry in boostLabIdsByHome nothing at all, not another colony's list", () => {
    const labB = labStub({ id: LAB_2, pos: { x: 6, y: 5 }, mineralType: HEAL_T3_COMPOUND, mineralAmount: LAB_BOOST_MINERAL });
    stubGame({ objects: { [LAB_2]: labB } });

    const { creep: creepC, traveled: traveledC } = boostableCreepInHome("roomC", "c1", ["heal"]);
    Game.creeps = { c1: creepC };

    const boostLabIdsByHome = new Map<string, readonly Id<StructureLab>[]>([["roomB", [LAB_2]]]);

    runCreepBehaviors(undefined, boostLabIdsByHome);

    expect(traveledC).toEqual([]);
    expect(creepC.memory.boosts).toEqual(["heal"]); // stays pending -- nothing was available to it
  });
});
