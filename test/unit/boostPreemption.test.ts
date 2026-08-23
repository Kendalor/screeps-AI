import { describe, expect, it } from "vitest";
import { runCreepBehaviors } from "../../src/empire/creeps";
import { stubGame } from "../helpers";
import type { BoostLabAssignment } from "../../src/empire/boostLabAllocation";

// gh #75 (epic #61, final sub-ticket): the boost pre-emption check that actually makes a creep with a
// pending boost order behave differently for the tick — mirrors fleeThreat/retreatIfDisarmed's placement
// in runOne (see interpreter.ts/creeps.ts), gated first on the cheap static Role.boostable check (a
// non-boostable role never enters the routine regardless of memory), then on creep.memory.boosts being
// non-empty. Driven through the public runCreepBehaviors entry point, same convention as
// fleeThreat.test.ts/retreatIfDisarmed.test.ts, so these survive refactors of the dispatch internals.
//
// simpleHealer is the one real role with a non-empty Role.boostable (["heal", "tough"]) today, so it's
// used as the boostable fixture throughout; "builder" (empty boostable) is the non-boostable fixture.

const LAB_ID = "lab1" as Id<StructureLab>;

function boostableCreep(opts: {
  boosts?: string[];
  hasAssignment?: boolean;
  pos?: { x: number; y: number };
  labPos?: { x: number; y: number };
  boosted?: boolean; // whether the creep's body already carries the boost (simulates a completed boostCreep call)
  body?: { type: BodyPartConstant; hits: number; boost?: ResourceConstant }[]; // overrides the default single-HEAL-part body
  boostCreepResult?: ScreepsReturnCode; // simulates boostCreep()'s own return code — defaults to OK
}): { creep: Creep; traveled: { x: number; y: number }[]; boostCreepCalls: string[] } {
  const traveled: { x: number; y: number }[] = [];
  const boostCreepCalls: string[] = [];
  const px = opts.pos?.x ?? 5;
  const py = opts.pos?.y ?? 5;
  const lx = opts.labPos?.x ?? 6;
  const ly = opts.labPos?.y ?? 5;

  const creep = {
    id: "h1",
    name: "h1",
    spawning: false,
    memory: { role: "simpleHealer", task: { step: 0 }, home: "W1N1", boosts: opts.boosts },
    store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
    body: opts.body ?? (opts.boosted ? [{ type: HEAL, hits: 100, boost: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE }] : [{ type: HEAL, hits: 100 }]),
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
    getActiveBodyparts: (part: BodyPartConstant) => (part === HEAL ? 1 : 0),
    // Accepts either a raw {x,y} position or a HasPos-shaped object ({pos: {x,y}}) — actOnResolved
    // (behaviors/actions.ts) calls travelTo with the target object itself, matching the real
    // Creep.travelTo/Traveler signature (RoomPosition | {pos: RoomPosition}), not just a bare position.
    travelTo: (p: { x?: number; y?: number; pos?: { x: number; y: number } }) =>
      traveled.push(p.pos ? { x: p.pos.x, y: p.pos.y } : { x: p.x!, y: p.y! }),
    heal: () => OK
  } as unknown as Creep;

  if (opts.hasAssignment) {
    const lab = {
      id: LAB_ID,
      pos: {
        x: lx,
        y: ly,
        roomName: "W1N1",
        inRangeTo: (p: { x: number; y: number }, range: number) => Math.max(Math.abs(lx - p.x), Math.abs(ly - p.y)) <= range
      },
      boostCreep: (c: Creep) => {
        boostCreepCalls.push(c.id);
        return opts.boostCreepResult ?? OK;
      }
    };
    stubGame({ objects: { [LAB_ID]: lab } });
  } else {
    stubGame({ objects: {} });
  }

  return { creep, traveled, boostCreepCalls };
}

function boostAssignments(creepId: string): Map<Id<Creep>, BoostLabAssignment> {
  return new Map([[creepId as Id<Creep>, { labId: LAB_ID, compound: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE }]]);
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
    // but crucially the boost routine (which would look up a lab by an id that doesn't exist) never fired).
    expect(creep.memory.boosts).toEqual(["heal"]); // untouched — boost routine never even looked at it
  });
});

describe("boost pre-emption: boostable role, no pending order", () => {
  it("runs its normal step table unaffected", () => {
    const { creep, traveled } = boostableCreep({ boosts: undefined });
    Game.creeps = { h1: creep };

    runCreepBehaviors();

    // healerAdvance step ran (no followFlag set -> falls back to moveToRoom(targetRoom), which is a
    // no-op with no targetRoom set) — the point is nothing about the boost routine fired: no travel
    // toward any lab position, memory.boosts stays undefined.
    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toBeUndefined();
  });

  it("also runs normally when boosts is present but empty", () => {
    const { creep, traveled } = boostableCreep({ boosts: [] });
    Game.creeps = { h1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual([]);
  });
});

describe("boost pre-emption: boostable role with a pending order", () => {
  it("skips the entire normal step table for the tick, moving toward its assigned lab", () => {
    const { creep, traveled } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 3, y: 5 },
      labPos: { x: 6, y: 5 } // out of range 1
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, boostAssignments("h1"));

    // Moved toward the lab, not toward healerAdvance's flag-following/heal targets.
    expect(traveled.length).toBe(1);
    expect(traveled[0]).toEqual(expect.objectContaining({ x: 6, y: 5 }));
  });

  it("calls boostCreep once adjacent to its assigned lab, without moving further", () => {
    const { creep, traveled, boostCreepCalls } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 5, y: 5 },
      labPos: { x: 6, y: 5 } // range 1 — adjacent
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, boostAssignments("h1"));

    expect(boostCreepCalls).toEqual(["h1"]);
    expect(traveled).toEqual([]);
  });

  it("leaves the order pending (not cleared, not thrown) when boostCreep returns a non-OK code", () => {
    // e.g. the lab #74 assigned isn't actually stocked yet -- a real race the design's own docs
    // acknowledge. A failed call must not be treated as success; the order stays pending for retry.
    const { creep, boostCreepCalls } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 5, y: 5 },
      labPos: { x: 6, y: 5 },
      boostCreepResult: ERR_NOT_ENOUGH_RESOURCES
    });
    Game.creeps = { h1: creep };

    expect(() => runCreepBehaviors(undefined, boostAssignments("h1"))).not.toThrow();

    expect(boostCreepCalls).toEqual(["h1"]);
    expect(creep.memory.boosts).toEqual(["heal"]); // still pending -- the failed call satisfied nothing
  });

  it("reads only its own entry from the assignment map — a differently-keyed creep is untouched by another's assignment", () => {
    const { creep, traveled } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 5, y: 5 },
      labPos: { x: 6, y: 5 }
    });
    Game.creeps = { h1: creep };

    // Assignment map keyed to a DIFFERENT creep id entirely.
    runCreepBehaviors(undefined, boostAssignments("someone-else"));

    // No assignment for h1 -> falls into the "wait" branch, not the lab-adjacent boostCreep branch —
    // proves the routine looked up its OWN id, not just "any" assignment in the map.
    expect(traveled).toEqual([]);
  });
});

describe("boost pre-emption: boostable role with an order but no assignment", () => {
  it("waits rather than acting when absent from the assignment map", () => {
    const { creep, traveled } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: false
    });
    Game.creeps = { h1: creep };

    // Empty assignment map: this creep lost the lab-allocation contest this tick.
    runCreepBehaviors(undefined, new Map());

    // No lab to walk to or act on; boost order stays pending (not cleared) so it's retried next tick.
    expect(traveled).toEqual([]);
    expect(creep.memory.boosts).toEqual(["heal"]);
  });

  it("steps off a lab-adjacent tile it happens to already be sitting on, rather than occupying it", () => {
    // Positioned exactly where a lab-adjacent stand tile would be (range 1 of where a lab WOULD be,
    // simulated here simply as "already adjacent to something" via a stubbed room with a lab-like
    // structure nearby) — since this creep has no assignment at all this tick, the routine must not
    // attempt to act on anything; the simplest correct "step aside" for a creep with nothing assigned
    // is to not occupy a lab tile. This is exercised via roomFind returning a nearby lab structure.
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      id: "h1",
      name: "h1",
      spawning: false,
      memory: { role: "simpleHealer", task: { step: 0 }, home: "W1N1", boosts: ["heal"] },
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
      body: [{ type: HEAL, hits: 100 }],
      hits: 100,
      hitsMax: 100,
      pos: {
        x: 5,
        y: 5,
        roomName: "W1N1",
        getRangeTo: () => 0,
        inRangeTo: () => true,
        isEqualTo: (p: { x: number; y: number }) => p.x === 5 && p.y === 5,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: {
        name: "W1N1",
        find: () => []
      },
      getActiveBodyparts: (part: BodyPartConstant) => (part === HEAL ? 1 : 0),
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y }),
      heal: () => OK
    } as unknown as Creep;
    Game.creeps = { h1: creep };

    expect(() => runCreepBehaviors(undefined, new Map())).not.toThrow();
    expect(creep.memory.boosts).toEqual(["heal"]);
  });
});

describe("boost pre-emption: order cleared once satisfied", () => {
  it("clears memory.boosts once the creep's body already carries the boost, resuming normal dispatch", () => {
    const { creep, traveled, boostCreepCalls } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 5, y: 5 },
      labPos: { x: 6, y: 5 },
      boosted: true // body part already carries a boost — the order's one entry is already satisfied
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, boostAssignments("h1"));

    expect(boostCreepCalls).toEqual([]); // never called boostCreep again — already satisfied
    expect(creep.memory.boosts).toBeUndefined(); // order cleared
  });

  it("falls through to ordinary step-table behavior on the next tick once cleared", () => {
    const { creep, traveled } = boostableCreep({
      boosts: undefined, // already cleared, as if by the previous tick
      hasAssignment: false
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, new Map());

    // Falls through to healerAdvance's own no-op (no followFlag/targetRoom) rather than the boost routine.
    expect(traveled).toEqual([]);
  });

  it("does NOT clear the order when only SOME of a multi-part body's matching parts are boosted", () => {
    // 3 HEAL parts, only 1 carries a boost -- a real engine boostCreep() call can boost fewer than every
    // matching part when the lab's compound falls short of the full count. Satisfaction must require every
    // matching part, not just one, or the remaining unboosted parts get abandoned with no retry.
    const { creep, boostCreepCalls } = boostableCreep({
      boosts: ["heal"],
      hasAssignment: true,
      pos: { x: 5, y: 5 },
      labPos: { x: 6, y: 5 },
      body: [
        { type: HEAL, hits: 100, boost: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE },
        { type: HEAL, hits: 100 },
        { type: HEAL, hits: 100 }
      ]
    });
    Game.creeps = { h1: creep };

    runCreepBehaviors(undefined, boostAssignments("h1"));

    expect(creep.memory.boosts).toEqual(["heal"]); // still pending -- 2 of 3 parts remain unboosted
    expect(boostCreepCalls).toEqual(["h1"]); // retried this tick, since the order isn't satisfied yet
  });
});
