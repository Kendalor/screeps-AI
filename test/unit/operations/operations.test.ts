// The seam itself: that a colony carries operations, that the arbiters poll them, and that an
// operation's demand is arbitrated on equal terms with an unowned requester's rather than
// short-circuiting past it.

import { describe, expect, it } from "vitest";
import { colony } from "../../../src/colony";
import { Operation } from "../../../src/operations/operation";
import { planSpawning } from "../../../src/systems/spawning";
import { planBuilding, wantedStructures } from "../../../src/systems/building";
import type { ColonySnapshot, SnapStructure } from "../../../src/snapshot/types";
import type { CreepRequest } from "../../../src/spawn/request";
import { stampLayout, type PlacedStructure } from "../../../src/layouts/stamp";
import { buildableAtRcl } from "../../../src/layouts/goal";
import type { GoalLayout } from "../../../src/layouts/sync";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import { colonySnap, sourceAt, spawn } from "../../fixtures";

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

const withOps = (snap: ColonySnapshot, ...operations: Operation[]) => ({ ...colony(snap), operations });

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
    memory: { role, home: "W1N1", op: "stub:W1N1" }
  });

  it("spawns an operation's request", () => {
    const snap = colonySnap({ spawns: [spawn()], energyAvailable: 300, sources: [] });
    const intents = planSpawning(withOps(snap, new Stub("W1N1", [request("hauler", 500)])));

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: "spawn", memory: { op: "stub:W1N1" } });
  });

  // Operations get no precedence for being operations: the arbiter sorts one flat list, so an
  // unowned requester at a higher priority still wins.
  it("orders operation demand against unowned demand by priority alone", () => {
    // Bootstrap (priority 100) outranks this operation's request, and only one spawn is idle.
    const snap = colonySnap({ spawns: [spawn()], energyAvailable: 300, sources: [sourceAt(20, 10)] });
    const intents = planSpawning(withOps(snap, new Stub("W1N1", [request("hauler", 1)])));

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
    const intents = planBuilding(withOps(snap, new Stub("W1N1", [], [claim])));

    expect(intents).toContainEqual({ kind: "placeSite", room: "W1N1", x: claim.x, y: claim.y, type: "container" });
  });

  // The demolition rule: tear down what no operation claims this tick. A structure an operation
  // still wants must survive it, or building demolishes what it just placed.
  it("does not tear down a structure an operation still claims", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [claim], sites: [] });
    const intents = planBuilding(withOps(snap, new Stub("W1N1", [], [claim])));

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
    expect(roadsOf([neighbour])).not.toContainEqual(neighbour);
  });

  it("tears down a structure no operation claims any more", () => {
    const snap = colonySnap({ anchor, controllerLevel: 3, structures: [claim], sites: [] });
    const intents = planBuilding(withOps(snap, new Stub("W1N1", [], [])));

    expect(intents).toContainEqual({
      kind: "removeStructure",
      room: "W1N1",
      x: claim.x,
      y: claim.y,
      type: "container"
    });
  });
});
