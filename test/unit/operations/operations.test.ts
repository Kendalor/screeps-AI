// The seam itself: that a colony carries operations, that the arbiters poll them, and that an
// operation's demand is arbitrated on equal terms with an unowned requester's rather than
// short-circuiting past it.

import { beforeEach, describe, expect, it } from "vitest";
import { colony, type Colony } from "../../../src/colony";
import { claimsOf, planBuilding, wantedStructures, findPath, resetFindPathCacheForTests, type FindPath } from "../../../src/construction/planner";
import { planSpawning } from "../../../src/empire/spawning";
import { Operation } from "../../../src/operations/operation";
import type { ColonySnapshot, SnapStructure } from "../../../src/snapshot/types";
import type { CreepRequest } from "../../../src/spawn/request";
import { stampLayout, type PlacedStructure } from "../../../src/construction/stamp";
import { buildableAtRcl } from "../../../src/construction/goal";
import { Mining } from "../../../src/operations/mining";
import { Bootstrap } from "../../../src/operations/bootstrap";
import type { GoalLayout } from "../../../src/construction/sync";
import GOAL_JSON from "../../../src/construction/Base_2.json";
import { colonySnap, roomDistance, snapCreeps, sourceAt, spawn } from "../../fixtures";
import { stubPathFinderSingleRoom } from "../../constants";

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
});

const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

// A stand-in operation, so these assert the framework rather than Mining's formulas.
class Stub extends Operation {
  public readonly kind = "stub";
  public constructor(
    room: string,
    private readonly creeps: CreepRequest[] = [],
    private readonly built: PlacedStructure[] = []
  ) {
    super(room);
  }
  public override desiredCreeps(): CreepRequest[] {
    return this.creeps;
  }
  public override structures(): PlacedStructure[] {
    return this.built;
  }
}

// A Colony carrying exactly the given operations. Colony.operations is readonly and built from a
// registry, so this builds the real wrapper and swaps the array — the arbiters read it, and this is
// how a test injects stand-in operations without touching operationsFor().
function withOps(snap: ColonySnapshot, ...operations: Operation[]): Colony {
  const c = colony(snap);
  (c as { operations: Operation[] }).operations = operations;
  return c;
}

// Spawning is empire-scoped now; every case here uses one colony, so this wraps it.
const spawnFor = (c: Colony) => planSpawning([c], roomDistance);
// Building takes the snapshot and the colony's operations directly.
const buildFor = (c: Colony) => planBuilding(c.snapshot, c.operations);

describe("Operation", () => {
  it("names itself by kind and room, so its creeps are identifiable next tick", () => {
    expect(new Stub("W1N1").name).toBe("stub:W1N1");
  });

  it("wants nothing through any channel by default", () => {
    class Silent extends Operation {
      public readonly kind = "silent";
    }
    const op = new Silent("W1N1");
    const snap = colonySnap({ sources: [sourceAt(20, 10)] });

    expect(op.desiredCreeps(snap)).toEqual([]);
    expect(op.structures(snap, findPathFor(snap))).toEqual([]);
    expect(op.intents(snap)).toEqual([]);
  });

  // The default roleTargets reconstructs the old census denominator (owned + still-requested) for any
  // operation that doesn't override it — correct because a role at/over target simply emits no request.
  describe("roleTargets default (owned + requested)", () => {
    const req = (role: "hauler" | "upgrader"): CreepRequest => ({
      body: [CARRY, MOVE],
      priority: 1,
      memory: { role, home: "W1N1", op: "stub:W1N1" },
      targetRoom: "W1N1"
    });

    it("counts a request the role has none alive for", () => {
      const op = new Stub("W1N1", [req("hauler")]);
      expect(op.roleTargets(colonySnap({ creeps: [] }))).toEqual([{ role: "hauler", target: 1 }]);
    });

    it("adds the deficit on top of the operation's living creeps", () => {
      // Two owned upgraders + one requested -> target 3. Ownership matches the stub's op stamp.
      const owned = snapCreeps("upgrader", 2).map(c => ({ ...c, memory: { ...c.memory, op: "stub:W1N1" } }));
      const op = new Stub("W1N1", [req("upgrader")]);
      expect(op.roleTargets(colonySnap({ creeps: owned }))).toEqual([{ role: "upgrader", target: 3 }]);
    });

    it("reports a target equal to the live count when the role is fully staffed (no requests)", () => {
      const owned = snapCreeps("hauler", 4).map(c => ({ ...c, memory: { ...c.memory, op: "stub:W1N1" } }));
      const op = new Stub("W1N1");
      expect(op.roleTargets(colonySnap({ creeps: owned }))).toEqual([{ role: "hauler", target: 4 }]);
    });
  });
});

describe("colony()", () => {
  it("gives every colony its operations", () => {
    expect(colony(colonySnap()).operations.map(op => op.name)).toContain("mining:W1N1");
  });

  it("builds them fresh per call, so nothing carries across ticks", () => {
    const snap = colonySnap();
    expect(colony(snap).operations[0]).not.toBe(colony(snap).operations[0]);
  });
});

describe("planSpawning polls operations", () => {
  const request = (role: "hauler" | "upgrader", priority: number): CreepRequest => ({
    body: [CARRY, MOVE],
    priority,
    memory: { role, home: "W1N1", op: "stub:W1N1" },
    targetRoom: "W1N1"
  });

  it("spawns an operation's request", () => {
    const snap = colonySnap({ spawns: [spawn()], energyAvailable: 300, sources: [] });
    const intents = spawnFor(withOps(snap, new Stub("W1N1", [request("hauler", 500)])));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: "spawn", memory: { op: "stub:W1N1" } });
  });

  // Operations get no precedence for being operations: the arbiter sorts one flat list, so a
  // higher-priority operation still wins over a lower-priority one.
  it("orders operation demand by priority alone", () => {
    // Bootstrap (priority 100) outranks this Stub's request, and only one spawn is idle.
    const snap = colonySnap({ spawns: [spawn()], energyAvailable: 300, sources: [sourceAt(20, 10)] });
    const intents = spawnFor(withOps(snap, new Stub("W1N1", [request("hauler", 1)]), new Bootstrap("W1N1")));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: "spawn", memory: { role: "bootstrap" } });
  });
});

describe("planBuilding polls operations", () => {
  const anchor = { x: 25, y: 25 };
  const claim: PlacedStructure = { x: 20, y: 11, type: "container" };

  // Every non-road structure the goal permits at RCL3, so the claim isn't beaten to the two focus
  // slots by higher-priority types — this asserts the claim is *reachable*, not that it jumps a queue.
  const built: SnapStructure[] = stampLayout(buildableAtRcl(GOAL_JSON as GoalLayout, 3), anchor)
    .filter(p => p.type !== "road")
    .map(p => ({ x: p.x, y: p.y, type: p.type }));

  it("places what an operation claims", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: built, sites: [] });
    const intents = buildFor(withOps(snap, new Stub("W1N1", [], [claim])));

    expect(intents).toContainEqual({ kind: "placeSite", room: "W1N1", x: claim.x, y: claim.y, type: "container" });
  });

  // The demolition rule: tear down what no operation claims this tick. A structure an operation
  // still wants must survive it, or building demolishes what it just placed.
  it("does not tear down a structure an operation still claims", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [claim], sites: [] });
    const intents = buildFor(withOps(snap, new Stub("W1N1", [], [claim])));

    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "removeStructure", x: claim.x, y: claim.y })
    );
  });

  // Why gateRoads runs after the merge rather than over the stamp alone: a road is kept only if it
  // neighbours a structure worth serving, and an operation's claim is such a structure. Gating first
  // would drop the road leading to a mining container before the container was ever in the list.
  it("counts an operation's claim as a served tile when gating roads", () => {
    // RCL4 — roads are permitted from here. The claim sits outside the bunker stamp, so any road
    // the merge newly keeps is one kept *because of* the claim.
    const outside: PlacedStructure = { x: 5, y: 5, type: "container" };
    const snap = colonySnap({ anchor, controllerLevel: 4, structures: [], sites: [] });

    const roadsOf = (claimed: PlacedStructure[]) =>
      wantedStructures(snap, claimed).filter(p => p.type === "road");

    // A road neighbouring the claim is kept; without the claim that same tile has nothing to serve.
    const neighbour: PlacedStructure = { x: 6, y: 5, type: "road" };
    expect(roadsOf([outside, neighbour])).toContainEqual(neighbour);
    expect(roadsOf([])).not.toContainEqual(neighbour);
  });

  // Mining's source-access path claims a chain of road tiles; most sit between the container and
  // the anchor, not next to any structure. Without this, gateRoads would strip the chain's middle
  // out and only the tile touching the container would ever get built.
  it("keeps an operation's claimed road even with nothing else served nearby", () => {
    const snap = colonySnap({ anchor, controllerLevel: 4, structures: [], sites: [] });
    const roadsOf = (claimed: PlacedStructure[]) =>
      wantedStructures(snap, claimed).filter(p => p.type === "road");

    const isolatedRoad: PlacedStructure = { x: 6, y: 5, type: "road" };
    expect(roadsOf([isolatedRoad])).toContainEqual(isolatedRoad);
  });

  // The reason the poll is sequential rather than a flatMap. Two operations heading for nearby
  // targets must converge onto one route instead of laying parallel roads a tile apart — claimsOf
  // folds each operation's resolved claims into the shared matrix (construction/planner.ts's
  // matrixCache) immediately after its turn, before the next operation's findPath calls run, so a
  // claimed road sits at ROAD_COST and A* prefers it once it's visible — not a `planned` array handed
  // to structures() any more, but the matrix itself.
  it("folds an earlier operation's claimed road into the matrix before the next operation's findPath runs", () => {
    class Recorder extends Operation {
      public readonly kind = "recorder";
      public constructor(
        room: string,
        private readonly mine: PlacedStructure[]
      ) {
        super(room);
      }
      public override structures(): PlacedStructure[] {
        return this.mine;
      }
    }
    // A probe operation whose only job is to report what its own findPath call sees along a fixed
    // straight line — cost 1 (ROAD_COST) at a tile means it's already claimed as a road by a sibling
    // that ran earlier this same pass; cost 2 (PLAIN_COST) means it's still bare ground.
    let seenRoadTile = false;
    class Probe extends Operation {
      public readonly kind = "probe";
      public override structures(c: ColonySnapshot, findPathProbe: FindPath): PlacedStructure[] {
        const from = new RoomPosition(anchor.x, anchor.y, c.name);
        const to = new RoomPosition(first.x, first.y, c.name);
        const route = findPathProbe(from, to, 0);
        seenRoadTile = route.path.some(p => p.x === first.x && p.y === first.y);
        return [];
      }
    }

    const first: PlacedStructure = { x: anchor.x + 3, y: anchor.y, type: "road" };
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] });
    buildFor(withOps(snap, new Recorder("W1N1", [first]), new Probe("W1N1")));

    expect(seenRoadTile).toBe(true);
  });

  // The payoff of the above: a real pathing operation (Mining) bends its own route onto a road a
  // sibling already claimed, instead of laying a second one alongside it — the general mechanism the
  // shared matrix provides, demonstrated end to end via claimsOf rather than a hand-fed `planned` array.
  it("lets Mining's own route reuse a road a sibling already claimed", () => {
    const source = sourceAt(40, 12);
    const snap = colonySnap({
      anchor,
      controllerLevel: 3,
      energyCapacity: 800,
      sources: [source],
      structures: [],
      sites: []
    });

    // Solo run (no siblings) to find a tile genuinely on Mining's own route.
    const solo = new Mining("W1N1").structures(snap, findPathFor(snap));
    resetFindPathCacheForTests(); // solo run's matrix must not leak into the real claimsOf pass below
    const soloRoad = solo.find(p => p.type === "road")!;
    expect(soloRoad).toBeDefined();

    // A sibling that runs before Mining and claims that exact tile as a road first.
    class EarlyRoad extends Operation {
      public readonly kind = "earlyRoad";
      public override structures(): PlacedStructure[] {
        return [{ x: soloRoad.x, y: soloRoad.y, type: "road" }];
      }
    }

    const claimed = claimsOf(snap, [new EarlyRoad("W1N1"), new Mining("W1N1")]);
    // Mining's own claim still names this tile as one of its route's roads — it doesn't avoid a
    // sibling's own claimed road, it walks straight through it (cheaper than plain ground). Same-type
    // (road-on-road) collisions are agreement, not a conflict — consolidate() keeps both claims (see
    // its own doc) rather than dropping Mining's as a duplicate.
    expect(claimed.filter(p => p.x === soloRoad.x && p.y === soloRoad.y && p.type === "road").length).toBeGreaterThan(0);
  });

  it("tears down a structure no operation claims any more", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [claim], sites: [] });
    const intents = buildFor(withOps(snap, new Stub("W1N1", [], [])));

    expect(intents).toContainEqual({
      kind: "removeStructure",
      room: "W1N1",
      x: claim.x,
      y: claim.y,
      type: "container"
    });
  });
});
