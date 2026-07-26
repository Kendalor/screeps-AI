// The seam itself: that a colony carries operations, that the arbiters poll them, and that an
// operation's demand is arbitrated on equal terms with an unowned requester's rather than
// short-circuiting past it.

import { describe, expect, it } from "vitest";
import { colony, type Colony } from "../../../src/colony";
import { planBuilding, wantedStructures } from "../../../src/colony/building";
import { planSpawning } from "../../../src/empire/spawning";
import { Operation } from "../../../src/operations/operation";
import type { ColonySnapshot, SnapStructure } from "../../../src/snapshot/types";
import type { CreepRequest } from "../../../src/spawn/request";
import { stampLayout, type PlacedStructure } from "../../../src/layouts/stamp";
import { buildableAtRcl, plannedObstacles } from "../../../src/layouts/goal";
import { Mining } from "../../../src/operations/mining";
import { Bootstrap } from "../../../src/operations/bootstrap";
import type { GoalLayout } from "../../../src/layouts/sync";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import { colonySnap, roomDistance, sourceAt, spawn } from "../../fixtures";

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
    expect(op.structures(snap)).toEqual([]);
    expect(op.intents(snap)).toEqual([]);
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

  // The same baseline planBuilding seeds its poll with.
  const plannedAt = (snap: ColonySnapshot) =>
    stampLayout(plannedObstacles(GOAL_JSON as GoalLayout, snap.controllerLevel, anchor, snap.sources), anchor);

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
  // targets must converge onto one route instead of laying parallel roads a tile apart — a planned
  // road sits at ROAD_COST, so A* prefers it once it is visible.
  it("shows each operation what the ones before it planned", () => {
    const seen: PlacedStructure[][] = [];
    class Recorder extends Operation {
      public readonly kind = "recorder";
      public constructor(
        room: string,
        private readonly mine: PlacedStructure[]
      ) {
        super(room);
      }
      public override structures(_c: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
        seen.push([...planned]);
        return this.mine;
      }
    }

    const first: PlacedStructure = { x: 5, y: 5, type: "container" };
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] });
    buildFor(withOps(snap, new Recorder("W1N1", [first]), new Recorder("W1N1", [])));

    // Both saw the layout baseline; only the second saw the first's claim.
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContainEqual(first);
    expect(seen[1]).toContainEqual(first);
    expect(seen[0].length).toBeGreaterThan(0);
  });

  // The payoff of the above: an operation that paths bends onto an existing planned route rather
  // than laying its own a tile over.
  it("lets a pathing operation reuse a road a sibling already planned", () => {
    const source = sourceAt(40, 12);
    const snap = colonySnap({ anchor, controllerLevel: 3, sources: [source], structures: [], sites: [] });

    const alone = new Mining("W1N1").structures(snap, plannedAt(snap));
    // A sibling that already planned the first half of the very route Mining would take. Derived
    // from Mining's own solo claim rather than guessed, so the two genuinely overlap.
    const soloRoads = alone.filter(p => p.type === "road");
    const corridor = soloRoads.slice(0, Math.floor(soloRoads.length / 2));
    expect(corridor.length).toBeGreaterThan(0);

    const withCorridor = new Mining("W1N1").structures(snap, [...plannedAt(snap), ...corridor]);

    const roadKeys = (s: PlacedStructure[]) => new Set(s.filter(p => p.type === "road").map(p => `${p.x},${p.y}`));
    const corridorKeys = new Set(corridor.map(p => `${p.x},${p.y}`));

    // With the corridor visible, Mining claims fewer new roads: the shared tiles are already planned.
    expect(roadKeys(withCorridor).size).toBeLessThan(roadKeys(alone).size);
    // And it never re-claims a tile the corridor already covers.
    for (const k of roadKeys(withCorridor)) expect(corridorKeys.has(k)).toBe(false);
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
