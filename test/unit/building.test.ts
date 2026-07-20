import { describe, expect, it } from "vitest";
import type { Intent } from "../../src/intents/types";
import { desiredBuilderCount, planBuilding } from "../../src/systems/building";
import type { SnapStructure } from "../../src/snapshot/types";
import { colony, empire, sourceAt } from "../fixtures";
import { minedStructures } from "../../src/systems/mining";

describe("building planner", () => {
  // The whole point of issue #22: Base_2.json has no containers, so unless
  // building.ts collects mining's per-source declarations the colony can never
  // build a container, and miner/hauler quotas stay pinned at 0 forever.
  it("places the source containers that mining declares", () => {
    const snap = empire(
      colony({
        anchor: { x: 25, y: 25 },
        controllerLevel: 3,
        sources: [sourceAt(20, 10)],
        structures: [],
        sites: []
      })
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

  it("emits placeSite intents for the RCL2 buildable subset (spawn + 5 extensions), not RCL3+ structures", () => {
    const snap = empire(
      colony({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        structures: [],
        sites: []
      })
    );

    const intents = planBuilding(snap);

    expect(intents.every(i => i.kind === "placeSite")).toBe(true);
    const byType = (t: string) => intents.filter(i => i.kind === "placeSite" && i.type === t);
    expect(byType("spawn")).toHaveLength(1);
    expect(byType("extension")).toHaveLength(5);
    // Everything placed is spawn/extension/road (roads gated to only those
    // adjacent to the placed cluster), plus the source containers mining
    // declares from RCL2 (issue #22) — no RCL3+ stamp type (link, storage, ...)
    // leaks in.
    const types = new Set(intents.map(i => i.kind === "placeSite" && i.type));
    expect(
      [...types].every(t => t === "spawn" || t === "extension" || t === "road" || t === "container")
    ).toBe(true);
  });

  it("road gating: does not request a bunker road far from anything placed at this RCL", () => {
    const snap = empire(
      colony({
        anchor: { x: 25, y: 25 },
        controllerLevel: 2,
        structures: [],
        sites: []
      })
    );

    const intents = planBuilding(snap);

    // {-2,-6} relative to the anchor is deep in the outer road ring, nowhere
    // near the RCL2 spawn/extension cluster clustered around the anchor.
    const farRoad = intents.find(
      i => i.kind === "placeSite" && i.type === "road" && i.x === 23 && i.y === 19
    );
    expect(farRoad).toBeUndefined();

    // Sanity check the fixture actually exercises gating: some roads near the
    // cluster ARE requested, so the far-road absence isn't just "no roads at all".
    const anyRoad = intents.some(i => i.kind === "placeSite" && i.type === "road");
    expect(anyRoad).toBe(true);
  });

  it("emits nothing once every RCL-appropriate structure already exists (idempotency)", () => {
    const anchor = { x: 25, y: 25 };
    const first = planBuilding(empire(colony({ anchor, controllerLevel: 2, structures: [], sites: [] })));
    const structures: SnapStructure[] = first
      .filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite")
      .map(i => ({ x: i.x, y: i.y, type: i.type }));

    const rebuilt = planBuilding(empire(colony({ anchor, controllerLevel: 2, structures, sites: [] })));

    expect(rebuilt).toEqual([]);
  });

  it("emits nothing further once the room is already at the construction-site cap", () => {
    const sites: SnapStructure[] = Array.from({ length: MAX_CONSTRUCTION_SITES }, (_, i) => ({
      x: i,
      y: 0,
      type: "road"
    }));

    const snap = empire(
      colony({ anchor: { x: 25, y: 25 }, controllerLevel: 2, structures: [], sites })
    );

    expect(planBuilding(snap)).toEqual([]);
  });

  it("RCL-up unlocks the next tier's intents without re-requesting already-built structures", () => {
    const anchor = { x: 25, y: 25 };
    const rcl2 = planBuilding(empire(colony({ anchor, controllerLevel: 2, structures: [], sites: [] })));
    const structures: SnapStructure[] = rcl2
      .filter((i): i is Extract<Intent, { kind: "placeSite" }> => i.kind === "placeSite")
      .map(i => ({ x: i.x, y: i.y, type: i.type }));

    const rcl3 = planBuilding(empire(colony({ anchor, controllerLevel: 3, structures, sites: [] })));

    // Nothing already built at RCL2 is re-requested...
    for (const s of structures) {
      expect(rcl3.some(i => i.kind === "placeSite" && i.x === s.x && i.y === s.y && i.type === s.type)).toBe(
        false
      );
    }
    // ...but RCL3-only structures (e.g. the first tower, extension cap 5->10) now appear.
    expect(rcl3.some(i => i.kind === "placeSite" && i.type === "tower")).toBe(true);
    expect(rcl3.filter(i => i.kind === "placeSite" && i.type === "extension")).toHaveLength(5);
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
