// The quota has two regimes now: pre-storage, a small dedicated squad leads the RCL climb; with
// storage, the ported getMaxUpgraders formula scales on what storage holds. Constructs the operation
// directly and hands it a snapshot: no Game mock, no Colony.

import { beforeEach, describe, expect, it } from "vitest";
import GOAL_JSON from "../../../src/construction/Base_2.json";
import type { GoalLayout } from "../../../src/construction/sync";
import type { XY } from "../../../src/lib/geometry";
import { Upgrading } from "../../../src/operations/upgrading";
import { findPath, resetFindPathCacheForTests, type FindPath } from "../../../src/construction/planner";
import { colonySnap, containerAt, dropAt, linkAt, snapCreeps, structureAt } from "../../fixtures";
import { stubPathFinderSingleRoom } from "../../constants";
import type { ColonySnapshot } from "../../../src/snapshot/types";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
});

// Every test drives Upgrading.structures() through the real planner findPath (real PathFinder.search,
// single-room, stubbed via stubPathFinderSingleRoom) — the same seam production code uses.
const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

const chebyshev = (a: XY, b: XY): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const storageOffset = (GOAL_JSON as GoalLayout).placements.find(p => p.type === "storage")!;
const storageTileFor = (anchor: XY): XY => ({ x: storageOffset.x + anchor.x, y: storageOffset.y + anchor.y });

describe("Upgrading.desiredCreeps — pre-storage squad", () => {
  it("fields a base squad (one per source) once there is energy to draw from, no surplus", () => {
    // A filled mining container is a source of energy the upgrader role can withdraw from.
    const one = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }],
      containers: [containerAt(21, 10, 500)]
    });
    expect(one).toHaveLength(2); // base 1 + ceil(500/1000)=1

    const two = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [
        { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
        { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
      ],
      containers: [containerAt(21, 10, 500)]
    });
    expect(two).toHaveLength(3); // base 2 + ceil(500/1000)=1
  });

  it("also works off ground drops before any container is built", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(2); // base 1 + ceil(200/1000)=1
  });

  it("asks for nothing pre-storage with no container energy and no drops — nothing to withdraw from", () => {
    expect(upgraderRequests({ storageEnergy: 0, controllerLevel: 2, containers: [], drops: [] })).toEqual([]);
  });

  it("is viable from RCL1 — it is what climbs the controller off room start", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 1, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(2); // base 1 + ceil(200/1000)=1
  });

  // When energy piles up unspent, add consumers so it does not rot — one extra upgrader per 1k of
  // standing surplus (drops + container), on top of the per-source base, up to maxUpgraders.
  it("scales up with the standing energy surplus, capped at maxUpgraders", () => {
    const oneSource = [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }];
    // base 1 + ceil(3500/1000)=4 → 5 upgraders to burn down a 3.5k drop pile.
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, sources: oneSource, drops: [dropAt(20, 10, 3500)] })
    ).toHaveLength(5);
    // A big enough surplus is clamped to the maxUpgraders ceiling rather than growing without bound.
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, sources: oneSource, drops: [dropAt(20, 10, 9000)] })
    ).toHaveLength(6);
  });

  // Container energy counts toward the surplus just like ground drops.
  it("counts container energy toward the surplus", () => {
    const oneSource = [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }];
    expect(
      upgraderRequests({
        storageEnergy: 0,
        controllerLevel: 2,
        constructionProgress: 0,
        sources: oneSource,
        containers: [containerAt(21, 10, 2000)]
      })
    ).toHaveLength(3); // base 1 + floor(2000/1000)=2
  });

  // While there is construction to do, upgrading holds at the floor so builders win the energy —
  // completing an extension compounds, and a scaled-up upgrader squad was measured to starve it.
  it("holds at one upgrader while construction is outstanding, despite a surplus", () => {
    const twoSources = [
      { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
      { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
    ];
    expect(
      upgraderRequests({
        storageEnergy: 0,
        controllerLevel: 2,
        constructionProgress: 6_000, // extensions to build
        sources: twoSources,
        drops: [dropAt(20, 10, 5000)] // big surplus, but building comes first
      })
    ).toHaveLength(1);
  });
});

describe("Upgrading.desiredCreeps — with storage (ported getMaxUpgraders)", () => {
  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(upgraderRequests({ storageEnergy: 100_000, controllerLevel: 4 })).toHaveLength(0);
    expect(upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 })).toHaveLength(1);
    expect(upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6 })).toHaveLength(4);
  });

  it("returns nothing once the live upgraders meet the quota", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 4) })
    ).toEqual([]);
  });

  it("asks only for the shortfall when some upgraders are already alive", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 3) })
    ).toHaveLength(1);
  });

  it("stamps its own op name on every request", () => {
    const [request] = upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 });

    expect(request.memory).toMatchObject({ role: "upgrader", home: "W1N1", op: "upgrading:W1N1" });
  });
});


describe("Upgrading.roleTargets — metrics denominator", () => {
  it("reports the true upgrader target, matching the quota", () => {
    expect(upgrading.roleTargets(colonySnap({ storageEnergy: 500_000, controllerLevel: 6 }))).toEqual([
      { role: "upgrader", target: 4 }
    ]);
  });

  it("reports a target below the live count as a surplus once energy no longer supports them", () => {
    // 4 upgraders alive, but storage has fallen so the target is 0: desiredCreeps hides it, roleTargets exposes 4/0.
    const snap = colonySnap({ storageEnergy: 100_000, controllerLevel: 4, creeps: snapCreeps("upgrader", 4) });
    expect(upgrading.desiredCreeps(snap)).toEqual([]);
    expect(upgrading.roleTargets(snap)).toEqual([{ role: "upgrader", target: 0 }]);
  });
});

describe("Upgrading.structures — controller container + road", () => {
  const anchor: XY = { x: 25, y: 25 };
  const controller: XY = { x: 25, y: 40 };
  // A room that has just reached the gate: RCL3 with every extension, capacity 800.
  const gated = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({ anchor, controller, controllerLevel: 3, energyCapacity: 800, ...over });

  it("claims exactly one container within range 1 of the controller", () => {
    const snap = gated();
    const containers = upgrading.structures(snap, findPathFor(snap)).filter(s => s.type === "container");

    expect(containers).toHaveLength(1);
    expect(chebyshev(containers[0], controller)).toBeLessThanOrEqual(1);
  });

  it("stays in upgrade range: the container is never further than range 3 from the controller", () => {
    const snap = gated();
    const [container] = upgrading.structures(snap, findPathFor(snap)).filter(s => s.type === "container");

    // Range 1 is the target, but the load-bearing property is "an upgrader on it can still upgrade".
    expect(chebyshev(container, controller)).toBeLessThanOrEqual(3);
  });

  it("claims a road linking the container back toward the storage tile", () => {
    const snap = gated();
    const claimed = upgrading.structures(snap, findPathFor(snap));
    const roads = claimed.filter(s => s.type === "road");
    const [container] = claimed.filter(s => s.type === "container");

    expect(roads.length).toBeGreaterThan(0);
    // The road nearest storage is adjacent to where storage will sit; the road nearest the
    // controller is adjacent to the container — i.e. a connected run from storage to the container.
    const storage = storageTileFor(anchor);
    expect(roads.some(r => chebyshev(r, storage) === 1)).toBe(true);
    expect(roads.some(r => chebyshev(r, container) === 1)).toBe(true);
    // The container tile itself is never also claimed as road.
    expect(roads).not.toContainEqual({ x: container.x, y: container.y, type: "road" });
  });

  // Capacity, not level, is the gate: 549 is one short. A room that cannot fund the container asks
  // for nothing, exactly as its creep demand is gated by current state.
  it("withholds the container below the energyCapacity gate", () => {
    const snap = gated({ energyCapacity: 549 });
    expect(upgrading.structures(snap, findPathFor(snap))).toEqual([]);
  });

  it("claims nothing before an anchor exists", () => {
    const snap = gated({ anchor: null });
    expect(upgrading.structures(snap, findPathFor(snap))).toEqual([]);
  });

  // No duplicate tiles within Upgrading's own claim. Cross-operation dedup/type-precedence
  // (a sibling's same-tile claim, a bunker-grid collision) is now the planner's own consolidate()
  // concern — see construction/planner.test.ts's "consolidate" coverage.
  it("never claims the same tile twice", () => {
    const snap = gated();
    const claimed = upgrading.structures(snap, findPathFor(snap));
    const keys = claimed.map(c => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // findPath's clearBunkerFootprint option (planner.ts) keeps the controller-approach search from ever
  // landing inside the bunker's own footprint — a live bug class this option exists to close (a search
  // that terminates on a bunker-interior tile would collide with the goal layout itself).
  it("never lands its container/link inside the bunker footprint", () => {
    const snap = gated();
    const claimed = upgrading.structures(snap, findPathFor(snap));
    const [container] = claimed.filter(s => s.type === "container" || s.type === "link");
    expect(chebyshev(container, anchor)).toBeGreaterThan(0);
  });

  // A real home-room wall must still be routed around — the matrix seeds IMPASSABLE from
  // colony.terrain directly (construction/planner.ts's seedMatrixFor), so this is a basic sanity check
  // that findPath's caller-supplied terrain is actually what the search uses.
  it("never routes its road across a home-room wall", () => {
    const terrain = new Uint8Array(2500).fill(1); // all walkable
    const wallX = anchor.x - 5;
    const wallY = anchor.y + 8; // sits between storage and the controller on the straight-line path
    terrain[wallX * 50 + wallY] = 0; // a real home-room wall

    const snap = gated({ terrain });
    const claimed = upgrading.structures(snap, findPathFor(snap));
    const roads = claimed.filter(s => s.type === "road");

    expect(roads.length).toBeGreaterThan(0);
    expect(roads.some(r => r.x === wallX && r.y === wallY)).toBe(false);
  });
});

describe("Upgrading.structures — link swap at RCL5", () => {
  const anchor: XY = { x: 25, y: 25 };
  const controller: XY = { x: 25, y: 40 };
  const gated = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({ anchor, controller, controllerLevel: 5, energyCapacity: 800, ...over });

  it("claims a link instead of a container once the room reaches RCL5", () => {
    const snap = gated();
    const claimed = upgrading.structures(snap, findPathFor(snap));

    expect(claimed.filter(s => s.type === "container")).toHaveLength(0);
    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect(chebyshev(links[0], controller)).toBeLessThanOrEqual(1);
  });

  it("still below the gate, RCL4 keeps claiming a container", () => {
    const snap = gated({ controllerLevel: 4 });
    const claimed = upgrading.structures(snap, findPathFor(snap));

    expect(claimed.filter(s => s.type === "link")).toHaveLength(0);
    expect(claimed.filter(s => s.type === "container")).toHaveLength(1);
  });

  it("the link sits at the same spot the container would have, still roaded back to storage", () => {
    const rcl5 = gated();
    const rcl4 = gated({ controllerLevel: 4 });
    const linkClaim = upgrading.structures(rcl5, findPathFor(rcl5)).find(s => s.type === "link")!;
    const containerClaim = upgrading.structures(rcl4, findPathFor(rcl4)).find(s => s.type === "container")!;

    expect({ x: linkClaim.x, y: linkClaim.y }).toEqual({ x: containerClaim.x, y: containerClaim.y });

    const roads = upgrading.structures(rcl5, findPathFor(rcl5)).filter(s => s.type === "road");
    expect(roads.some(r => chebyshev(r, linkClaim) === 1)).toBe(true);
  });

  // The matrix findPath routes against is plan-only (terrain + bunker layout + accumulated claims,
  // never colony.structures — see construction/planner.ts's own doc), so a previously-built controller
  // link is never read as an obstacle in the first place: structures() keeps re-deriving the same
  // natural spot once the link is actually built and recorded there, never a second one nearby.
  it("keeps claiming the same spot once its own link is built and recorded, not a second one nearby", () => {
    const base = gated();
    const natural = upgrading.structures(base, findPathFor(base)).find(s => s.type === "link")!;
    const builtLink = linkAt(natural.x, natural.y, 0);

    const built = gated({
      structures: [structureAt(natural.x, natural.y, "link", { id: builtLink.id })],
      links: [builtLink],
      linkNetwork: { controller: builtLink.id }
    });
    const claimed = upgrading.structures(built, findPathFor(built));

    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect({ x: links[0].x, y: links[0].y }).toEqual({ x: natural.x, y: natural.y });
  });

  it("re-derives the same natural spot once the recorded link no longer exists (destroyed)", () => {
    const base = gated();
    const natural = upgrading.structures(base, findPathFor(base)).find(s => s.type === "link")!;

    const destroyed = gated({
      structures: [], // the link is gone from the room
      links: [], // and gone from the live link list
      linkNetwork: { controller: "dead-id" as Id<StructureLink> } // but memory still points at it
    });
    const claimed = upgrading.structures(destroyed, findPathFor(destroyed));

    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect({ x: links[0].x, y: links[0].y }).toEqual({ x: natural.x, y: natural.y });
  });

  // Regression for a real relocation bug: findPath's matrix is reseeded fresh every claimsOf pass from
  // terrain + bunker layout + whatever OTHER operations staged this tick (Mining runs before Upgrading —
  // see operations/index.ts's operationsFor order). That staged state legitimately varies tick to tick
  // (remote selection churn, a newly built road), and with many equal-cost goal tiles available in
  // clearBunkerFootprint's goal set, a different sibling-claim landscape can tip PathFinder's own
  // tie-break to a DIFFERENT tile than the one actually built — reading as a second link claim (the old
  // one goes stale/demolished, a new site opens elsewhere). structures() must PIN to the already-built
  // tile once one exists, never trust wherever this tick's fresh search happens to land.
  //
  // Driven with a spy FindPath that deliberately returns a DIFFERENT structurePos than the real built
  // link's tile (simulating exactly the tie-break drift a sibling claim could cause) — the only way to
  // prove structures() ignores the search's own endpoint choice once a link is built, rather than
  // happening to agree with it because the test's own conditions never actually drifted.
  it("pins to the already-built link's tile even when findPath's own search would land elsewhere", () => {
    const builtLink = linkAt(24, 39, 0);
    const built = gated({
      structures: [structureAt(24, 39, "link", { id: builtLink.id })],
      links: [builtLink],
      linkNetwork: { controller: builtLink.id }
    });

    // A driftedFindPath that always resolves to a decoy tile far from the real built link — if
    // structures() ever trusted this call's own endpoint, the claim would land at the decoy instead.
    const decoy = { x: 30, y: 30 };
    const driftedFindPath: FindPath = () => ({ path: [decoy], structurePos: decoy });

    const claimed = upgrading.structures(built, driftedFindPath);
    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect({ x: links[0].x, y: links[0].y }).toEqual({ x: 24, y: 39 });
    expect({ x: links[0].x, y: links[0].y }).not.toEqual(decoy);
  });
});

describe("Upgrading.intents — controller link recording", () => {
  const anchor: XY = { x: 25, y: 25 };
  const controller: XY = { x: 25, y: 40 };
  const gated = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({ anchor, controller, controllerLevel: 5, energyCapacity: 800, ...over });

  it("records any built link within range of the controller, even off structures()' exact route tile", () => {
    // Regression: a link built before the current pathing code (or nudged by a later road/obstacle
    // change) can legitimately sit one tile off from where a fresh A* route would land today —
    // detection must not require an exact match against structures()' own computed tile.
    const link = linkAt(controller.x + 1, controller.y, 0); // range 1, not necessarily the A* tile

    const intents = upgrading.intents(gated({ links: [link] }));
    expect(intents).toContainEqual({ kind: "recordLinkNetwork", room: "W1N1", controller: link.id });
  });

  it("does not record anything before a link is built near the controller", () => {
    expect(upgrading.intents(gated({ links: [] }))).toEqual([]);
  });

  it("does not record a link outside the controller's range", () => {
    const farLink = linkAt(controller.x + 5, controller.y, 0);
    expect(upgrading.intents(gated({ links: [farLink] }))).toEqual([]);
  });

  it("does not re-record once the controller link is already known", () => {
    const link = linkAt(controller.x + 1, controller.y, 0);
    const intents = upgrading.intents(gated({ links: [link], linkNetwork: { controller: link.id } }));
    expect(intents).toEqual([]);
  });

  it("does not mistake the anchor link for the controller link even if it happened to be in range", () => {
    const anchorLink = linkAt(controller.x + 1, controller.y, 0);
    const intents = upgrading.intents(gated({ links: [anchorLink], linkNetwork: { storage: anchorLink.id } }));
    expect(intents).toEqual([]);
  });

  it("does not mistake a source link for the controller link even if it happened to be in range", () => {
    const sourceLink = linkAt(controller.x + 1, controller.y, 0);
    const intents = upgrading.intents(
      gated({ links: [sourceLink], sourceMemory: { src_0: { linkId: sourceLink.id } } })
    );
    expect(intents).toEqual([]);
  });

  it("does not record anything below the link tier (still on a container)", () => {
    const link = linkAt(controller.x + 1, controller.y, 0); // a link oddly present pre-RCL5 shouldn't be recorded yet
    expect(upgrading.intents(gated({ controllerLevel: 4, links: [link] }))).toEqual([]);
  });

  // recordLinkNetwork only ever adds an id (never clears one), so once the live link behind a recorded
  // id is destroyed, the stale id would otherwise block re-recording forever — intents() must re-detect.
  it("re-records once a replacement link is built after the old recorded one is destroyed", () => {
    const replacement = linkAt(controller.x + 1, controller.y, 0);
    const intents = upgrading.intents(
      gated({ links: [replacement], linkNetwork: { controller: "dead-id" as Id<StructureLink> } })
    );
    expect(intents).toContainEqual({ kind: "recordLinkNetwork", room: "W1N1", controller: replacement.id });
  });
});
