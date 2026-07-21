import { describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import { desiredBuilderCount, planBuilding } from "../../src/systems/building";
import type { SnapStructure } from "../../src/snapshot/types";
import { colony, empire, sourceAt } from "../fixtures";
import { minedStructures } from "../../src/systems/mining";
import { buildableAtRcl } from "../../src/layouts/goal";
import { stampLayout } from "../../src/layouts/stamp";
import type { GoalLayout } from "../../src/layouts/sync";
import GOAL_JSON from "../../src/layouts/Base_2.json";
import type { XY } from "../../src/lib/geometry";

// Every non-road structure the goal permits at `rcl`, stamped at the anchor and
// shaped as built structures — used to drive the planner to a state where only
// roads remain buildable.
function allNonRoadStructuresAt(anchor: XY, rcl: number): SnapStructure[] {
  return stampLayout(buildableAtRcl(GOAL_JSON as GoalLayout, rcl), anchor)
    .filter(p => p.type !== "road")
    .map(p => ({ x: p.x, y: p.y, type: p.type }));
}

describe("building planner", () => {
  // The whole point of issue #22: Base_2.json has no containers, so unless
  // building.ts collects mining's per-source declarations the colony can never
  // build a container, and miner/hauler quotas stay pinned at 0 forever.
  it("places the source containers that mining declares (once higher priorities are built)", () => {
    // Issue #22: mining declares a container per source that the bunker stamp
    // lacks. It ranks below tower/extensions and is gated to RCL3+, so build the
    // higher priorities first, then the container becomes the next site placed.
    const anchor = { x: 25, y: 25 };
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap = empire(
      colony({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: built, sites: [] })
    );

    const intents = planBuilding(snap);

    const [container] = minedStructures(snap.colonies[0]);
    expect(intents).toContainEqual({
      kind: "placeSite",
      room: "W1N1",
      x: container.x,
      y: container.y,
      type: "container"
    });
  });

  it("does not re-place a source container that already exists", () => {
    const base = colony({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = empire({ ...base, structures: [container] });

    const intents = planBuilding(snap);

    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "placeSite", x: container.x, y: container.y })
    );
  });

  it("does not tear down a source container as a stale structure", () => {
    const base = colony({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = empire({ ...base, structures: [container] });

    const intents = planBuilding(snap);

    // Containers are absent from the bunker stamp by design — the teardown
    // pass must consult mining's declarations too, or it demolishes the very
    // container it just placed, every planning cycle.
    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "removeStructure", x: container.x, y: container.y })
    );
  });

  it("places only RCL2-buildable structural sites (no RCL3+ type, no roads), within the focus cap", () => {
    const snap = empire(
      colony({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        sources: [sourceAt(20, 10)],
        structures: [],
        sites: []
      })
    );

    const intents = planBuilding(snap);

    expect(intents.every(i => i.kind === "placeSite")).toBe(true);
    // The focus cap keeps at most 2 open at once, and roads are held until RCL4.
    expect(intents).toHaveLength(2);
    const types = new Set(intents.map(i => i.kind === "placeSite" && i.type));
    expect([...types].some(t => t === "road")).toBe(false);
    // Only RCL2-permitted types (spawn/extension/container) — no RCL3+ stamp
    // type (tower, link, storage, ...) leaks in.
    expect(
      [...types].every(t => t === "spawn" || t === "extension" || t === "container")
    ).toBe(true);
  });

  it("emits nothing once every RCL-appropriate structure already exists (idempotency)", () => {
    const anchor = { x: 25, y: 25 };
    const base = colony({ anchor, controllerLevel: 2, structures: [], sites: [] });
    // Every RCL2 non-road structure already built — the bunker stamp plus the
    // source containers mining declares (roads are held pre-RCL4, so nothing
    // else is buildable) -> the planner requests no more sites.
    const containers: SnapStructure[] = minedStructures(base).map(c => ({ x: c.x, y: c.y, type: c.type }));
    const built = [...allNonRoadStructuresAt(anchor, 2), ...containers];
    const rebuilt = planBuilding(empire({ ...base, structures: built }));

    expect(rebuilt.filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("emits nothing further once the room is already at the focus site cap", () => {
    // Two open sites already -> at the focus cap, nothing more is requested.
    const sites: SnapStructure[] = [
      { x: 1, y: 0, type: "extension" },
      { x: 2, y: 0, type: "extension" }
    ];

    const snap = empire(
      colony({ anchor: { x: 25, y: 25 }, controllerLevel: 2, structures: [], sites })
    );

    expect(planBuilding(snap).filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("RCL-up unlocks the next tier's intents without re-requesting already-built structures", () => {
    const anchor = { x: 25, y: 25 };
    // All RCL2 structures already built; step up to RCL3.
    const structures = allNonRoadStructuresAt(anchor, 2);
    const rcl3 = planBuilding(empire(colony({ anchor, controllerLevel: 3, structures, sites: [] })));

    // Nothing already built at RCL2 is re-requested...
    for (const s of structures) {
      expect(rcl3.some(i => i.kind === "placeSite" && i.x === s.x && i.y === s.y && i.type === s.type)).toBe(
        false
      );
    }
    // ...and the RCL3-unlocked tower, being top priority, is one of the two
    // sites the focus cap allows.
    expect(rcl3.some(i => i.kind === "placeSite" && i.type === "tower")).toBe(true);
  });

  it("flags a stale non-spawn structure (present but absent from the goal layout) for removal", () => {
    const anchor = { x: 25, y: 25 };
    // {35,35} is anchor {25,25} + {10,10} — nowhere in Base_2.json's goal placements.
    const stale: SnapStructure = { x: 35, y: 35, type: "tower" };

    const snap = empire(colony({ anchor, controllerLevel: 3, structures: [stale], sites: [] }));

    const removals = planBuilding(snap).filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([{ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "tower" }]);
  });

  it("never auto-demolishes a spawn at a stale position, even when it's the room's only spawn", () => {
    const anchor = { x: 25, y: 25 };
    // {35,35} is anchor {25,25} + {10,10} — nowhere in Base_2.json's goal placements.
    const staleSpawn: SnapStructure = { x: 35, y: 35, type: "spawn" };

    const snap = empire(colony({ anchor, controllerLevel: 3, structures: [staleSpawn], sites: [] }));

    const removals = planBuilding(snap).filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([]);
  });
});

// Focused construction so a small pre-storage workforce finishes structures
// instead of smearing effort across a whole RCL's worth of sites (gh #23
// follow-up). Three rules: at most 2 open sites at once, a type priority for
// which 2, and no roads before RCL4.
describe("building planner focus policy", () => {
  const anchor = { x: 25, y: 25 };
  const placeSites = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite");

  it("places at most 2 construction sites at a time", () => {
    const snap = empire(colony({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    expect(placeSites(planBuilding(snap))).toHaveLength(2);
  });

  it("counts existing sites against the cap of 2", () => {
    const oneOpen: SnapStructure[] = [{ x: 10, y: 10, type: "road" }];
    const snap = empire(colony({ anchor, controllerLevel: 3, structures: [], sites: oneOpen }));

    // One site already open -> room for exactly one more.
    expect(placeSites(planBuilding(snap))).toHaveLength(1);
  });

  it("prioritises the tower ahead of extensions when both are buildable", () => {
    // RCL3 unlocks the first tower and extensions 6-10. With only 2 slots the
    // tower must be one of them.
    const snap = empire(colony({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    const placed = placeSites(planBuilding(snap));
    expect(placed.some(i => i.type === "tower")).toBe(true);
  });

  it("places no container sites before RCL3", () => {
    // Containers exist for miners, and miners don't spawn until RCL3-with-
    // extensions — a container built at RCL2 is 5000 energy nobody uses yet, and
    // it would starve the focus slots that should be growing extensions.
    for (const rcl of [1, 2]) {
      const snap = empire(
        colony({ anchor, controllerLevel: rcl, sources: [sourceAt(20, 10)], structures: [], sites: [] })
      );
      expect(placeSites(planBuilding(snap)).some(i => i.type === "container")).toBe(false);
    }
  });

  it("places container sites from RCL3", () => {
    const snap = empire(
      colony({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: [], sites: [] })
    );
    // Not necessarily in the first 2 slots (tower/extensions rank higher), but
    // once those are built the container is buildable. Build out the higher
    // priorities and confirm the container then appears.
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap2 = empire(
      colony({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: built, sites: [] })
    );
    void snap;
    expect(placeSites(planBuilding(snap2)).some(i => i.type === "container")).toBe(true);
  });

  it("ranks containers below extensions in the focus slots", () => {
    // At RCL3 with tower already built, the 2 slots should go to extensions
    // before the container — extensions grow capacity, the container waits.
    const withTower = [
      ...allNonRoadStructuresAt(anchor, 3).filter(s => s.type === "tower")
    ];
    const snap = empire(
      colony({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: withTower, sites: [] })
    );
    const placed = placeSites(planBuilding(snap));
    expect(placed.every(i => i.type === "extension")).toBe(true);
    expect(placed.some(i => i.type === "container")).toBe(false);
  });

  it("places no roads before RCL4", () => {
    // Roads are dead weight while the structural bunker is still going up, and
    // pre-RCL4 the colony has no spare build capacity for them.
    for (const rcl of [2, 3]) {
      const snap = empire(colony({ anchor, controllerLevel: rcl, structures: [], sites: [] }));
      expect(placeSites(planBuilding(snap)).some(i => i.type === "road")).toBe(false);
    }
  });

  it("road gating at RCL4: paves near placed structures, not the far outer ring", () => {
    // Roads unlock at RCL4; once structures are built the road network grows
    // only where it touches them ("roads only where needed", issue #16).
    const builtStructures = allNonRoadStructuresAt(anchor, 4);
    const snap = empire(colony({ anchor, controllerLevel: 4, structures: builtStructures, sites: [] }));
    const placed = placeSites(planBuilding(snap));

    // A far outer-ring road tile (anchor + {-2,-6}) is nowhere near the cluster.
    expect(placed.some(i => i.type === "road" && i.x === 23 && i.y === 19)).toBe(false);
    // But roads adjacent to the built cluster ARE requested.
    expect(placed.some(i => i.type === "road")).toBe(true);
  });

});

describe("desiredBuilderCount (ported BuildOperation builder quota)", () => {
  it("returns 0 when there is nothing left to build", () => {
    expect(desiredBuilderCount(colony({ constructionProgress: 0, storageEnergy: 200_000 }))).toBe(0);
  });

  it("scales one builder per 5k of remaining work when storage can bankroll them", () => {
    expect(desiredBuilderCount(colony({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toBe(1);
    expect(desiredBuilderCount(colony({ constructionProgress: 8_000, storageEnergy: 200_000 }))).toBe(2);
  });

  it("caps the quota so a full bunker rollout cannot swallow all spawn capacity", () => {
    expect(desiredBuilderCount(colony({ constructionProgress: 500_000, storageEnergy: 2_000_000 }))).toBe(4);
  });

  it("holds the storage reserve back: no builders when storage cannot cover the reserve plus the build cost", () => {
    // Reserve is 50k (ported from BuildOperation); a 10k backlog costs 10k energy
    // to finish, so storage must clear 60k before a builder is affordable.
    expect(desiredBuilderCount(colony({ constructionProgress: 10_000, storageEnergy: 55_000 }))).toBe(0);
    expect(desiredBuilderCount(colony({ constructionProgress: 10_000, storageEnergy: 65_000 }))).toBe(2);
  });

  it("asks for no dedicated builders before storage exists — bootstrap's build step covers construction that early", () => {
    expect(desiredBuilderCount(colony({ constructionProgress: 20_000, storageEnergy: 0, controllerLevel: 3 }))).toBe(0);
  });
});
