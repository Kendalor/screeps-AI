import { describe, expect, it } from "vitest";
import { buildCostMatrix, sourceRoadPath } from "../../src/layouts/roads";
import { minedStructures, planMining } from "../../src/systems/mining";
import { colony, containerAt, empire, openTerrain, sourceAt } from "../fixtures";

// Where the planner *should* put the source structure, derived independently
// from the already-ported road pathing rather than hardcoded — the test states
// the rule ("last road tile, adjacent to the source"), not a magic coordinate.
function expectedSpot(anchor: { x: number; y: number }, source: { x: number; y: number }) {
  const cm = buildCostMatrix({ terrain: openTerrain(), structures: [] });
  return sourceRoadPath(anchor, source, cm).structurePos;
}

describe("minedStructures", () => {
  it("declares a container on the last road tile next to each source", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colony({ anchor, sources: [source], controllerLevel: 3 });

    const declared = minedStructures(snap);

    const spot = expectedSpot(anchor, source);
    expect(declared).toContainEqual({ x: spot.x, y: spot.y, type: "container" });
  });

  it("declares a container per source", () => {
    const snap = colony({
      anchor: { x: 25, y: 25 },
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      controllerLevel: 3
    });

    expect(minedStructures(snap).filter(s => s.type === "container")).toHaveLength(2);
  });

  it("declares containers at RCL2 without waiting for storage", () => {
    const snap = colony({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 2,
      storageEnergy: 0,
      storageId: undefined
    });

    // Legacy gated the whole building list on room.storage — backwards, since
    // containers are what fund the economy that pays for storage (issue #22).
    expect(minedStructures(snap)).toHaveLength(1);
  });

  it("declares nothing at RCL1, when the miner economy cannot be afforded yet", () => {
    const snap = colony({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 1
    });

    expect(minedStructures(snap)).toEqual([]);
  });

  it("declares a link instead of a container at RCL7", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colony({ anchor, sources: [source], controllerLevel: 7 });

    const declared = minedStructures(snap);

    const spot = expectedSpot(anchor, source);
    expect(declared).toEqual([{ x: spot.x, y: spot.y, type: "link" }]);
  });

  // Stability matters more than optimality here: the declaration is compared
  // against what's built, so a spot that moves once the container exists makes
  // building.ts place a container, then demolish it and place another, forever.
  it("keeps declaring the same spot once the container is built there", () => {
    const base = colony({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3
    });

    const [first] = minedStructures(base);
    const [second] = minedStructures({ ...base, structures: [first] });

    expect(second).toEqual(first);
  });

  it("declares nothing before an anchor is found", () => {
    const snap = colony({ anchor: null, sources: [sourceAt(20, 10)], controllerLevel: 3 });

    expect(minedStructures(snap)).toEqual([]);
  });
});

describe("planMining", () => {
  it("records each source's mining spot so roles can find it without re-pathing", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = empire(colony({ anchor, sources: [source], controllerLevel: 3 }));

    const intents = planMining(snap);

    const spot = expectedSpot(anchor, source);
    expect(intents).toContainEqual({
      kind: "recordSourceSpot",
      room: "W1N1",
      source: source.id,
      spot: { x: spot.x, y: spot.y }
    });
  });

  it("records the container id once one exists on the source's spot", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const spot = expectedSpot(anchor, source);
    const container = containerAt(spot.x, spot.y);
    const snap = empire(
      colony({
        anchor,
        sources: [source],
        controllerLevel: 3,
        structures: [{ x: spot.x, y: spot.y, type: "container" }],
        containers: [container]
      })
    );

    const intents = planMining(snap);

    expect(intents).toContainEqual(
      expect.objectContaining({ kind: "recordSourceSpot", source: source.id, container: container.id })
    );
  });

  it("plans nothing for a colony with no anchor yet", () => {
    const snap = empire(colony({ anchor: null, sources: [sourceAt(20, 10)], controllerLevel: 3 }));

    expect(planMining(snap)).toEqual([]);
  });
});
