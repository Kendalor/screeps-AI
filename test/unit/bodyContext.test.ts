import { describe, expect, it } from "vitest";
import { bodyContext } from "../../src/spawn/bodyContext";
import { colonySnap, sourceAt } from "../fixtures";

// bodyContext derives what a body calculator needs to know beyond the energy budget. hasContainerSite is
// what lets a miner spawn with a CARRY so it can help build (and later repair) its own source container.
describe("bodyContext hasContainerSite", () => {
  it("is true when a container construction site sits adjacent to a source", () => {
    const ctx = bodyContext(
      colonySnap({
        sources: [sourceAt(20, 10)],
        sites: [{ x: 21, y: 11, type: STRUCTURE_CONTAINER }] // diagonally adjacent to the source
      })
    );
    expect(ctx.hasContainerSite).toBe(true);
  });

  it("is false for a container site that is not next to any source (e.g. the controller container)", () => {
    const ctx = bodyContext(
      colonySnap({
        sources: [sourceAt(20, 10)],
        sites: [{ x: 25, y: 25, type: STRUCTURE_CONTAINER }] // by the controller, two-plus tiles from the source
      })
    );
    expect(ctx.hasContainerSite).toBe(false);
  });

  it("is false for a non-container site next to a source (a road drop-off), and when there are no sites", () => {
    expect(
      bodyContext(colonySnap({ sources: [sourceAt(20, 10)], sites: [{ x: 21, y: 10, type: STRUCTURE_ROAD }] }))
        .hasContainerSite
    ).toBe(false);
    expect(bodyContext(colonySnap({ sites: [] })).hasContainerSite).toBe(false);
  });
});

// hasContainer must mean a SOURCE container (the tile a miner stands on), not any container: the
// controller container is a hauler deposit target that no miner ever occupies, so it must not flip a
// source's miner onto the container-miner body path.
describe("bodyContext hasContainer", () => {
  const container = (x: number, y: number) => ({
    id: `c_${x}_${y}` as Id<StructureContainer>,
    x,
    y,
    storeEnergy: 0,
    storeCapacity: 2000
  });

  it("is true when a built container sits adjacent to a source", () => {
    const ctx = bodyContext(colonySnap({ sources: [sourceAt(20, 10)], containers: [container(21, 11)] }));
    expect(ctx.hasContainer).toBe(true);
  });

  it("is false for the controller container alone (two-plus tiles from any source)", () => {
    const ctx = bodyContext(colonySnap({ sources: [sourceAt(20, 10)], containers: [container(25, 25)] }));
    expect(ctx.hasContainer).toBe(false);
  });

  it("stays true from the source container even when a controller container also exists", () => {
    const ctx = bodyContext(
      colonySnap({ sources: [sourceAt(20, 10)], containers: [container(21, 11), container(25, 25)] })
    );
    expect(ctx.hasContainer).toBe(true);
  });

  it("is false when there are no containers", () => {
    expect(bodyContext(colonySnap({ containers: [] })).hasContainer).toBe(false);
  });
});
