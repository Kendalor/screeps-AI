import { describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import { builderRequests, planBuilding } from "../../src/systems/building";
import type { SnapStructure } from "../../src/snapshot/types";
import { colony } from "../../src/colony";
import { colonySnap, snapCreeps, sourceAt, testColony } from "../fixtures";
import { minedStructures } from "../../src/systems/mining";
import { buildableAtRcl } from "../../src/layouts/goal";
import { stampLayout } from "../../src/layouts/stamp";
import type { GoalLayout } from "../../src/layouts/sync";
import GOAL_JSON from "../../src/layouts/Base_2.json";
import type { XY } from "../../src/lib/geometry";

// Every non-road structure the goal permits at `rcl`, stamped at the anchor.
function allNonRoadStructuresAt(anchor: XY, rcl: number): SnapStructure[] {
  return stampLayout(buildableAtRcl(GOAL_JSON as GoalLayout, rcl), anchor)
    .filter(p => p.type !== "road")
    .map(p => ({ x: p.x, y: p.y, type: p.type }));
}

describe("building planner", () => {
  // Base_2.json has no containers; building.ts must collect mining's per-source
  // declarations or the colony can never build one.
  it("places the source containers that mining declares (once higher priorities are built)", () => {
    const anchor = { x: 25, y: 25 };
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap = colony(
      colonySnap({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: built, sites: [] })
    );

    const intents = planBuilding(snap);

    const [container] = minedStructures(snap.snapshot);
    expect(intents).toContainEqual({
      kind: "placeSite",
      room: "W1N1",
      x: container.x,
      y: container.y,
      type: "container"
    });
  });

  it("does not re-place a source container that already exists", () => {
    const base = colonySnap({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = colony({ ...base, structures: [container] });

    const intents = planBuilding(snap);

    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "placeSite", x: container.x, y: container.y })
    );
  });

  it("does not tear down a source container as a stale structure", () => {
    const base = colonySnap({
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      sources: [sourceAt(20, 10)],
      structures: [],
      sites: []
    });
    const [container] = minedStructures(base);
    const snap = colony({ ...base, structures: [container] });

    const intents = planBuilding(snap);

    // Containers are absent from the bunker stamp by design; the teardown pass must
    // consult mining's declarations too, or it demolishes the container it just placed.
    expect(intents).not.toContainEqual(
      expect.objectContaining({ kind: "removeStructure", x: container.x, y: container.y })
    );
  });

  it("places only RCL2-buildable structural sites (no RCL3+ type, no roads), within the focus cap", () => {
    const snap = colony(
      colonySnap({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        sources: [sourceAt(20, 10)],
        structures: [],
        sites: []
      })
    );

    const intents = planBuilding(snap);

    expect(intents.every(i => i.kind === "placeSite")).toBe(true);
    expect(intents).toHaveLength(2);
    const types = new Set(intents.map(i => i.kind === "placeSite" && i.type));
    expect([...types].some(t => t === "road")).toBe(false);
    expect(
      [...types].every(t => t === "spawn" || t === "extension" || t === "container")
    ).toBe(true);
  });

  it("emits nothing once every RCL-appropriate structure already exists (idempotency)", () => {
    const anchor = { x: 25, y: 25 };
    const base = colonySnap({ anchor, controllerLevel: 2, structures: [], sites: [] });
    const containers: SnapStructure[] = minedStructures(base).map(c => ({ x: c.x, y: c.y, type: c.type }));
    const built = [...allNonRoadStructuresAt(anchor, 2), ...containers];
    const rebuilt = planBuilding(colony({ ...base, structures: built }));

    expect(rebuilt.filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("emits nothing further once the room is already at the focus site cap", () => {
    const sites: SnapStructure[] = [
      { x: 1, y: 0, type: "extension" },
      { x: 2, y: 0, type: "extension" }
    ];

    const snap = colony(
      colonySnap({ anchor: { x: 25, y: 25 }, controllerLevel: 2, structures: [], sites })
    );

    expect(planBuilding(snap).filter(i => i.kind === "placeSite")).toEqual([]);
  });

  it("RCL-up unlocks the next tier's intents without re-requesting already-built structures", () => {
    const anchor = { x: 25, y: 25 };
    const structures = allNonRoadStructuresAt(anchor, 2);
    const rcl3 = planBuilding(colony(colonySnap({ anchor, controllerLevel: 3, structures, sites: [] })));

    for (const s of structures) {
      expect(rcl3.some(i => i.kind === "placeSite" && i.x === s.x && i.y === s.y && i.type === s.type)).toBe(
        false
      );
    }
    expect(rcl3.some(i => i.kind === "placeSite" && i.type === "tower")).toBe(true);
  });

  it("flags a stale non-spawn structure (present but absent from the goal layout) for removal", () => {
    const anchor = { x: 25, y: 25 };
    const stale: SnapStructure = { x: 35, y: 35, type: "tower" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [stale], sites: [] }));

    const removals = planBuilding(snap).filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([{ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "tower" }]);
  });

  it("never auto-demolishes a spawn at a stale position, even when it's the room's only spawn", () => {
    const anchor = { x: 25, y: 25 };
    const staleSpawn: SnapStructure = { x: 35, y: 35, type: "spawn" };

    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [staleSpawn], sites: [] }));

    const removals = planBuilding(snap).filter(i => i.kind === "removeStructure");
    expect(removals).toEqual([]);
  });
});

// Focused construction: at most 2 open sites at once, a type priority for which 2,
// and no roads before RCL4.
describe("building planner focus policy", () => {
  const anchor = { x: 25, y: 25 };
  const placeSites = (intents: Intent[]) =>
    intents.filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite");

  it("places at most 2 construction sites at a time", () => {
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    expect(placeSites(planBuilding(snap))).toHaveLength(2);
  });

  it("counts existing sites against the cap of 2", () => {
    const oneOpen: SnapStructure[] = [{ x: 10, y: 10, type: "road" }];
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: oneOpen }));

    expect(placeSites(planBuilding(snap))).toHaveLength(1);
  });

  it("prioritises the tower ahead of extensions when both are buildable", () => {
    const snap = colony(colonySnap({ anchor, controllerLevel: 3, structures: [], sites: [] }));

    const placed = placeSites(planBuilding(snap));
    expect(placed.some(i => i.type === "tower")).toBe(true);
  });

  it("places no container sites before RCL3", () => {
    for (const rcl of [1, 2]) {
      const snap = colony(
        colonySnap({ anchor, controllerLevel: rcl, sources: [sourceAt(20, 10)], structures: [], sites: [] })
      );
      expect(placeSites(planBuilding(snap)).some(i => i.type === "container")).toBe(false);
    }
  });

  it("places container sites from RCL3", () => {
    const snap = colony(
      colonySnap({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: [], sites: [] })
    );
    const built = allNonRoadStructuresAt(anchor, 3);
    const snap2 = colony(
      colonySnap({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: built, sites: [] })
    );
    void snap;
    expect(placeSites(planBuilding(snap2)).some(i => i.type === "container")).toBe(true);
  });

  it("ranks containers below extensions in the focus slots", () => {
    const withTower = [
      ...allNonRoadStructuresAt(anchor, 3).filter(s => s.type === "tower")
    ];
    const snap = colony(
      colonySnap({ anchor, controllerLevel: 3, sources: [sourceAt(20, 10)], structures: withTower, sites: [] })
    );
    const placed = placeSites(planBuilding(snap));
    expect(placed.every(i => i.type === "extension")).toBe(true);
    expect(placed.some(i => i.type === "container")).toBe(false);
  });

  it("places no roads before RCL4", () => {
    for (const rcl of [2, 3]) {
      const snap = colony(colonySnap({ anchor, controllerLevel: rcl, structures: [], sites: [] }));
      expect(placeSites(planBuilding(snap)).some(i => i.type === "road")).toBe(false);
    }
  });

  it("road gating at RCL4: paves near placed structures, not the far outer ring", () => {
    const builtStructures = allNonRoadStructuresAt(anchor, 4);
    const snap = colony(colonySnap({ anchor, controllerLevel: 4, structures: builtStructures, sites: [] }));
    const placed = placeSites(planBuilding(snap));

    expect(placed.some(i => i.type === "road" && i.x === 23 && i.y === 19)).toBe(false);
    expect(placed.some(i => i.type === "road")).toBe(true);
  });

});

// The quota formula is ported verbatim from the builder count this replaced, so each count assertion survives
// as an assertion about how many requests come back.
describe("builderRequests (ported BuildOperation builder quota)", () => {
  it("asks for nothing when there is nothing left to build", () => {
    expect(builderRequests(testColony({ constructionProgress: 0, storageEnergy: 200_000 }))).toEqual([]);
  });

  it("scales one builder per 5k of remaining work when storage can bankroll them", () => {
    expect(builderRequests(testColony({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toHaveLength(1);
    expect(builderRequests(testColony({ constructionProgress: 8_000, storageEnergy: 200_000 }))).toHaveLength(2);
  });

  it("caps the quota so a full bunker rollout cannot swallow all spawn capacity", () => {
    expect(builderRequests(testColony({ constructionProgress: 500_000, storageEnergy: 2_000_000 }))).toHaveLength(4);
  });

  it("holds the storage reserve back: no builders when storage cannot cover the reserve plus the build cost", () => {
    // Reserve is 50k; a 10k backlog costs 10k energy, so storage must clear 60k first.
    expect(builderRequests(testColony({ constructionProgress: 10_000, storageEnergy: 55_000 }))).toHaveLength(0);
    expect(builderRequests(testColony({ constructionProgress: 10_000, storageEnergy: 65_000 }))).toHaveLength(2);
  });

  it("asks for no dedicated builders before storage exists — bootstrap's build step covers construction that early", () => {
    expect(
      builderRequests(testColony({ constructionProgress: 20_000, storageEnergy: 0, controllerLevel: 3 }))
    ).toEqual([]);
  });

  it("returns nothing once the live builders meet the quota", () => {
    const colony = testColony({
      constructionProgress: 8_000,
      storageEnergy: 200_000,
      creeps: snapCreeps("builder", 2)
    });

    expect(builderRequests(colony)).toEqual([]);
  });
});
