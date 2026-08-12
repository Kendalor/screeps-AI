import { describe, expect, it } from "vitest";
import { runCreepBehaviors } from "../../src/empire/creeps";
import { stubGame } from "../helpers";

// A defender/attacker that has lost every RANGED_ATTACK/ATTACK part to damage (getActiveBodyparts only
// counts parts with hits > 0) can no longer fight back — retreatIfDisarmed (src/behaviors/interpreter.ts)
// pulls it toward a friendly healer if one is visible in the room, else walks it home, instead of running
// the normal attack step. Driven through runCreepBehaviors, same convention as fleeThreat.test.ts.

function hostileAt(x: number, y: number) {
  return {
    id: "hostile1",
    pos: { x, y },
    owner: { username: "Invader" },
    getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0)
  };
}

function healerAt(x: number, y: number) {
  return {
    id: "healer1",
    pos: { x, y },
    getActiveBodyparts: (part: BodyPartConstant) => (part === HEAL ? 1 : 0)
  };
}

function disarmedFighter(
  role: "defender" | "attacker",
  opts: {
    home: string;
    roomName: string;
    friendlyCreeps?: object[];
    hostiles?: object[];
    hits?: number;
    hitsMax?: number;
  }
): { creep: Creep; traveled: { x: number; y: number }[] } {
  const traveled: { x: number; y: number }[] = [];
  const creep = {
    id: "d1",
    name: "d1",
    spawning: false,
    memory: { role, task: { step: 0 }, home: opts.home },
    store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
    hits: opts.hits,
    hitsMax: opts.hitsMax,
    pos: {
      x: 5,
      y: 5,
      roomName: opts.roomName,
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)),
      inRangeTo: (p: { x: number; y: number }, range: number) =>
        Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)) <= range,
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room: {
      name: opts.roomName,
      find: (kind: FindConstant) => {
        if (kind === FIND_HOSTILE_CREEPS) return opts.hostiles ?? [];
        if (kind === FIND_MY_CREEPS) return opts.friendlyCreeps ?? [];
        return [];
      }
    },
    // Every weapon part destroyed — a bare MOVE husk.
    getActiveBodyparts: () => 0,
    travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
  } as unknown as Creep;
  return { creep, traveled };
}

function disarmedDefender(opts: {
  home: string;
  roomName: string;
  friendlyCreeps?: object[];
  hostiles?: object[];
  hits?: number;
  hitsMax?: number;
}): { creep: Creep; traveled: { x: number; y: number }[] } {
  return disarmedFighter("defender", opts);
}

describe("retreatIfDisarmed: defender with no intact RANGED_ATTACK parts", () => {
  it("retreats toward the nearest friendly healer in the room", () => {
    stubGame({ objects: {} });
    const healer = healerAt(10, 5);
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W1N1",
      friendlyCreeps: [healer]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 10, y: 5 }]);
  });

  it("picks the closer of two healers", () => {
    stubGame({ objects: {} });
    const far = healerAt(20, 5);
    const near = healerAt(8, 5);
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W1N1",
      friendlyCreeps: [far, near]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 8, y: 5 }]);
  });

  it("heads home when no healer is visible in the room", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W2N2",
      hostiles: [hostileAt(9, 5)]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 25, y: 25 }]);
  });

  it("heads for the recorded bunker anchor (not room centre) when one exists — walks fully into the room instead of stalling on the border", () => {
    stubGame({ objects: {} });
    Memory.colonies = { W1N1: { anchor: { x: 12, y: 38 } } } as unknown as typeof Memory.colonies;
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W2N2",
      hostiles: [hostileAt(9, 5)]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 12, y: 38 }]);
  });

  it("does nothing once already home with no healer around (no-op, same as moveToRoom on arrival)", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W1N1",
      hostiles: [hostileAt(9, 5)]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
  });

  it("stays parked home (no attack step, no travel) while below full hits, even with a hostile present", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W1N1",
      hostiles: [hostileAt(9, 5)],
      hits: 40,
      hitsMax: 100
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
    expect(creep.memory.task).toEqual({ step: 0 }); // never advanced into the normal step table
  });

  it("releases back to normal dispatch once home and fully healed", () => {
    stubGame({ objects: {} });
    const h = hostileAt(9, 5); // range 4 — attackStep (ranged, no ranged parts left) falls back to melee-close travelTo
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W1N1",
      hostiles: [h],
      hits: 100,
      hitsMax: 100
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    // No longer intercepted by retreatIfDisarmed — falls through into the normal attack step. But this
    // fixture's getActiveBodyparts always reads 0 (see disarmedFighter's doc: "every weapon part
    // destroyed"), i.e. genuinely 0 dps against a live RANGED_ATTACK hostile — find:"hostile" now
    // excludes a fight the creep can only lose (see targets.ts's wouldLoseTo), so the attack step has no
    // target to resolve and the creep holds instead of walking itself into melee with something it can
    // never hurt back.
    expect(traveled).toEqual([]);
  });

  it("prefers the healer over heading home even away from home", () => {
    stubGame({ objects: {} });
    const healer = healerAt(6, 5);
    const { creep, traveled } = disarmedDefender({
      home: "W1N1",
      roomName: "W2N2",
      friendlyCreeps: [healer]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 6, y: 5 }]);
  });
});

describe("retreatIfDisarmed: defender still carrying an active RANGED_ATTACK part", () => {
  it("does not retreat — runs its normal attack step instead", () => {
    stubGame({ objects: {} });
    const h = hostileAt(9, 5); // range 4, outside firing range 3
    const traveled: { x: number; y: number }[] = [];
    const creep = {
      name: "d1",
      spawning: false,
      memory: { role: "defender", task: { step: 0 }, home: "W1N1" },
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
      pos: {
        x: 5,
        y: 5,
        roomName: "W1N1",
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)),
        inRangeTo: (p: { x: number; y: number }, range: number) =>
          Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)) <= range,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { name: "W1N1", find: (kind: FindConstant) => (kind === FIND_HOSTILE_CREEPS ? [h] : []) },
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0),
      rangedAttack: () => OK,
      rangedMassAttack: () => OK,
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    } as unknown as Creep;
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    // Closes in on the hostile via attackStep, not retreatIfDisarmed.
    expect(traveled).toEqual([{ x: 9, y: 5 }]);
  });
});

describe("retreatIfDisarmed: attacker with no intact ATTACK parts", () => {
  it("heads home when no healer is visible in the room", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = disarmedFighter("attacker", {
      home: "W1N1",
      roomName: "W2N2",
      hostiles: [hostileAt(9, 5)]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 25, y: 25 }]);
  });

  it("retreats toward a friendly healer instead", () => {
    stubGame({ objects: {} });
    const healer = healerAt(6, 5);
    const { creep, traveled } = disarmedFighter("attacker", {
      home: "W1N1",
      roomName: "W2N2",
      friendlyCreeps: [healer]
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 6, y: 5 }]);
  });

  it("stays parked home while below full hits", () => {
    stubGame({ objects: {} });
    const { creep, traveled } = disarmedFighter("attacker", {
      home: "W1N1",
      roomName: "W1N1",
      hostiles: [hostileAt(9, 5)],
      hits: 40,
      hitsMax: 100
    });
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
    expect(creep.memory.task).toEqual({ step: 0 });
  });
});
