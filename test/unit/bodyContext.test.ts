import { describe, expect, it } from "vitest";
import { bodyContext } from "../../src/spawn/bodyContext";
import { colonySnap, remoteSourceAt, sourceAt } from "../fixtures";

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

// roads (allRemoteRoutesBuilt) drives the hauler/transport 2:1 MOVE:CARRY ratio: only worth it once every
// remote route is actually paved. Confirmed live on W47N14 2026-08-12: routeBuilt could never reach all
// "1"s because the route itself passes through tiles that were never going to get a road (the container
// tile, and — right next to the anchor — a tile the bunker layout claims for a spawn), so transporters
// stayed stuck at the off-road 1:1 ratio forever, even with every genuine road built.
describe("bodyContext roads (allRemoteRoutesBuilt)", () => {
  const anchor = { x: 37, y: 8 }; // matches construction/Base_2.json's anchor-relative spawn at (-1,-1) -> (36,7)

  it("is false with no remote source selected yet", () => {
    expect(bodyContext(colonySnap({ anchor, controllerLevel: 7 })).roads).toBe(false);
  });

  it("is false while a genuine road tile in the route is still unbuilt", () => {
    const source = remoteSourceAt(10, 10, "W2N1", {
      route: [
        { room: "W1N1", x: 30, y: 8 }, // genuine road tile, not built
        { room: "W2N1", x: 10, y: 10 } // container tile (last)
      ],
      routeBuilt: "0"
    });
    const ctx = bodyContext(colonySnap({ anchor, controllerLevel: 7, remoteSources: [source] }));
    expect(ctx.roads).toBe(false);
  });

  it("is true once every genuine road tile is built, even though the container/bunker-obstacle tiles never confirm", () => {
    const source = remoteSourceAt(10, 10, "W2N1", {
      route: [
        { room: "W1N1", x: 36, y: 7 }, // sits on the bunker's spawn tile — never gets a road
        { room: "W1N1", x: 30, y: 8 }, // genuine road tile, built
        { room: "W2N1", x: 10, y: 10 } // container tile (last) — never gets a road either
      ],
      routeBuilt: "010" // only the genuine road index is (or ever will be) confirmed
    });
    const ctx = bodyContext(colonySnap({ anchor, controllerLevel: 7, remoteSources: [source] }));
    expect(ctx.roads).toBe(true);
  });

  it("is false if any selected source's genuine road tiles aren't all confirmed", () => {
    const paved = remoteSourceAt(10, 10, "W2N1", {
      route: [
        { room: "W1N1", x: 30, y: 8 }, // genuine road tile, built
        { room: "W2N1", x: 10, y: 10 } // container tile (last)
      ],
      routeBuilt: "10"
    });
    const unpaved = remoteSourceAt(20, 20, "W3N1", {
      route: [
        { room: "W1N1", x: 31, y: 9 }, // genuine road tile, NOT built
        { room: "W3N1", x: 20, y: 20 } // container tile (last)
      ],
      routeBuilt: "00"
    });
    const ctx = bodyContext(colonySnap({ anchor, controllerLevel: 7, remoteSources: [paved, unpaved] }));
    expect(ctx.roads).toBe(false);
  });
});
