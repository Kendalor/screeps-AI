// The quota has two regimes now: pre-storage, a small dedicated squad leads the RCL climb; with
// storage, the ported getMaxUpgraders formula scales on what storage holds. Constructs the operation
// directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import type { GoalLayout } from "../../../src/layouts/sync";
import type { XY } from "../../../src/lib/geometry";
import { Upgrading } from "../../../src/operations/upgrading";
import { colonySnap, containerAt, dropAt, linkAt, snapCreeps, structureAt } from "../../fixtures";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

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
    const containers = upgrading.structures(gated()).filter(s => s.type === "container");

    expect(containers).toHaveLength(1);
    expect(chebyshev(containers[0], controller)).toBeLessThanOrEqual(1);
  });

  it("stays in upgrade range: the container is never further than range 3 from the controller", () => {
    const [container] = upgrading.structures(gated()).filter(s => s.type === "container");

    // Range 1 is the target, but the load-bearing property is "an upgrader on it can still upgrade".
    expect(chebyshev(container, controller)).toBeLessThanOrEqual(3);
  });

  it("claims a road linking the container back toward the storage tile", () => {
    const claimed = upgrading.structures(gated());
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
    expect(upgrading.structures(gated({ energyCapacity: 549 }))).toEqual([]);
  });

  it("claims nothing before an anchor exists", () => {
    expect(upgrading.structures(gated({ anchor: null }))).toEqual([]);
  });

  // Two structures on one tile is not a plan planBuilding can execute.
  it("never claims a tile a sibling already planned", () => {
    const claimed = upgrading.structures(gated());
    // Feed its own claim back as the planned set: nothing new may be claimed on those tiles.
    const planned = claimed.map(c => ({ x: c.x, y: c.y, type: c.type }));
    const second = upgrading.structures(gated(), planned);

    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    for (const c of second) expect(taken.has(`${c.x},${c.y}`)).toBe(false);
  });

  // A live bug: the bunker's own road grid is seeded into `planned` before any operation runs (see
  // claimsOf), unconditionally — not capacity-gated the way built roads are. If controllerContainerPath's
  // A* happens to terminate on a tile that grid already claims as a road, the naive claim silently
  // vanishes (the dedup drops it with nowhere else to go) rather than finding a free tile nearby — the
  // container never gets claimed again, at any RCL, until the bunker layout around it changes.
  it("still claims a container when its natural tile is already planned as a road", () => {
    const natural = upgrading.structures(gated()).find(s => s.type === "container")!;
    const planned = [{ x: natural.x, y: natural.y, type: "road" as const }];

    const claimed = upgrading.structures(gated(), planned);
    const containers = claimed.filter(s => s.type === "container");

    expect(containers).toHaveLength(1);
    expect({ x: containers[0].x, y: containers[0].y }).not.toEqual({ x: natural.x, y: natural.y });
    expect(chebyshev(containers[0], controller)).toBeLessThanOrEqual(1);
  });
});

describe("Upgrading.structures — link swap at RCL5", () => {
  const anchor: XY = { x: 25, y: 25 };
  const controller: XY = { x: 25, y: 40 };
  const gated = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({ anchor, controller, controllerLevel: 5, energyCapacity: 800, ...over });

  it("claims a link instead of a container once the room reaches RCL5", () => {
    const claimed = upgrading.structures(gated());

    expect(claimed.filter(s => s.type === "container")).toHaveLength(0);
    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect(chebyshev(links[0], controller)).toBeLessThanOrEqual(1);
  });

  it("still below the gate, RCL4 keeps claiming a container", () => {
    const claimed = upgrading.structures(gated({ controllerLevel: 4 }));

    expect(claimed.filter(s => s.type === "link")).toHaveLength(0);
    expect(claimed.filter(s => s.type === "container")).toHaveLength(1);
  });

  it("the link sits at the same spot the container would have, still roaded back to storage", () => {
    const linkClaim = upgrading.structures(gated()).find(s => s.type === "link")!;
    const containerClaim = upgrading.structures(gated({ controllerLevel: 4 })).find(s => s.type === "container")!;

    expect({ x: linkClaim.x, y: linkClaim.y }).toEqual({ x: containerClaim.x, y: containerClaim.y });

    const roads = upgrading.structures(gated()).filter(s => s.type === "road");
    expect(roads.some(r => chebyshev(r, linkClaim) === 1)).toBe(true);
  });

  // A live bug: once the link is actually built, it's a real obstacle (unlike a container, links aren't
  // in roads.ts's WALKABLE_STRUCTURES) — so re-running the same A* on a later tick can no longer land
  // back on its own tile and instead terminates on a *different* tile adjacent to the controller. Nothing
  // is built there yet, so building.ts sites it too: a second link goes up next to the first. structures()
  // must keep re-deriving the same spot the recorded link already sits at.
  it("keeps claiming the same spot once its own link is built and recorded, not a second one nearby", () => {
    const natural = upgrading.structures(gated()).find(s => s.type === "link")!;
    const builtLink = linkAt(natural.x, natural.y, 0);

    const claimed = upgrading.structures(
      gated({
        structures: [structureAt(natural.x, natural.y, "link", { id: builtLink.id })],
        links: [builtLink],
        linkNetwork: { controller: builtLink.id }
      })
    );

    const links = claimed.filter(s => s.type === "link");
    expect(links).toHaveLength(1);
    expect({ x: links[0].x, y: links[0].y }).toEqual({ x: natural.x, y: natural.y });
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
});
