import { describe, expect, it } from "vitest";
import { runCreepBehaviors } from "../../src/empire/creeps";
import { stubGame } from "../helpers";

// Role.flee (miner, repair, hauler, transport/supply) breaks off its normal work and retreats once an
// armed, reputation-dangerous hostile closes within FLEE_RADIUS (4) — driven through the public
// runCreepBehaviors entry point, same convention as creepDispatch.test.ts, so these survive refactors
// of the dispatch internals.

function hostile(x: number, y: number, opts: { armed?: boolean; ranged?: boolean; owner?: string } = {}) {
  const armed = opts.armed ?? true;
  const ranged = opts.ranged ?? false;
  return {
    id: "hostile1",
    pos: { x, y },
    owner: { username: opts.owner ?? "Invader" },
    getActiveBodyparts: (part: BodyPartConstant) => {
      if (part === ATTACK) return armed && !ranged ? 1 : 0;
      if (part === RANGED_ATTACK) return ranged ? 1 : 0;
      return 0;
    }
  };
}

const OPEN_TERRAIN = { getTerrain: () => ({ get: () => 0 }) };

// A miner standing at its source: harvest is step 0's target once a source is in reach.
// harvested is an array (not a count) so the caller's snapshot, taken before runCreepBehaviors() runs,
// still reflects mutations the harvest() closure makes during that call.
function miner(hostiles: object[]): { creep: Creep; traveled: { x: number; y: number }[]; harvested: number[] } {
  const traveled: { x: number; y: number }[] = [];
  const harvested: number[] = [];
  const source = { id: "src", energy: 100, pos: { x: 5, y: 5, findInRange: () => [] }, room: OPEN_TERRAIN };
  const creep = {
    name: "m1",
    spawning: false,
    memory: { role: "miner", task: { step: 0 }, sourceId: "src", home: "W1N1" },
    store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
    pos: {
      x: 5,
      y: 5,
      roomName: "W1N1",
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)),
      inRangeTo: () => true,
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room: {
      find: (kind: FindConstant) => {
        if (kind === FIND_HOSTILE_CREEPS) return hostiles;
        if (kind === FIND_SOURCES) return [source];
        return [];
      }
    },
    harvest: () => {
      harvested.push(1);
      return 0;
    },
    travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
  } as unknown as Creep;
  return { creep, traveled, harvested };
}

describe("Role.flee: miner", () => {
  // Distinct Game.time per test: targets.ts's claimCache memoizes findCandidates' claim counts by tick,
  // and every stubGame() call here defaults to time 0 — without varying it, a later test would read the
  // share-cap cache a prior test populated for the same source id instead of recomputing it fresh.
  it("flees an armed hostile within range instead of harvesting", () => {
    stubGame({ objects: { src: { id: "src" } }, time: 1 });
    const { creep, traveled } = miner([hostile(7, 5, { armed: true })]); // range 2
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    // Hostile due east at range 2 — flees west (and off-axis, fleeSpot's fallback nudge).
    expect(traveled).toEqual([{ x: 4, y: 6 }]);
  });

  it("flees a ranged-armed hostile the same as a melee one", () => {
    stubGame({ objects: { src: { id: "src" } }, time: 2 });
    const { creep, traveled } = miner([hostile(9, 5, { armed: false, ranged: true })]); // range 4
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 4, y: 6 }]);
  });

  it("does not flee an unarmed hostile (scout/healer/claimer) — keeps harvesting", () => {
    stubGame({ objects: { src: { id: "src" } }, time: 3 });
    const { creep, traveled } = miner([hostile(6, 5, { armed: false, ranged: false })]);
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
  });

  it("does not flee an armed hostile belonging to a non-dangerous (neutral-reputation) owner", () => {
    stubGame({ objects: { src: { id: "src" } }, time: 4 });
    const { creep, traveled } = miner([hostile(6, 5, { armed: true, owner: "SomeUnflaggedPlayer" })]);
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
  });

  it("does not flee an armed hostile beyond FLEE_RADIUS", () => {
    stubGame({ objects: { src: { id: "src" } }, time: 5 });
    const { creep, traveled, harvested } = miner([hostile(10, 5, { armed: true })]); // range 5
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([]);
    expect(harvested).toEqual([1]);
  });
});

describe("Role.flee: transport/supply (diverted before the step table)", () => {
  it("a transport creep flees an armed hostile instead of running its logistics task", () => {
    stubGame({ objects: {} });
    const traveled: { x: number; y: number }[] = [];
    const h = hostile(7, 5, { armed: true });
    const creep = {
      name: "t1",
      spawning: false,
      memory: { role: "transport", logistics: {}, home: "W1N1" },
      pos: {
        x: 5,
        y: 5,
        roomName: "W1N1",
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(5 - p.x), Math.abs(5 - p.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { find: (kind: FindConstant) => (kind === FIND_HOSTILE_CREEPS ? [h] : []) },
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    } as unknown as Creep;
    Game.creeps = { t1: creep };

    runCreepBehaviors();

    expect(traveled).toEqual([{ x: 4, y: 6 }]);
  });
});

describe("Role.flee: does not apply to combat roles", () => {
  it("a defender does not flee the hostile it is meant to engage", () => {
    stubGame({ objects: {} });
    const traveled: { x: number; y: number }[] = [];
    const h = hostile(9, 5, { armed: true }); // range 4 — inside FLEE_RADIUS, outside firing range
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
      // An active RANGED_ATTACK part, same as a real defender body (defender.ts's DEFENDER_SET) —
      // keeps retreatIfDisarmed from treating this as a disarmed husk that must retreat instead.
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0),
      rangedAttack: () => OK,
      rangedMassAttack: () => OK,
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    } as unknown as Creep;
    Game.creeps = { d1: creep };

    runCreepBehaviors();

    // Closes in on the hostile (attackStep's own close-in logic, since nothing nearby carries ATTACK)
    // rather than retreating from it — Defender has no Role.flee, so fleeThreat never even runs for it.
    expect(traveled).toEqual([{ x: 9, y: 5 }]);
  });
});
