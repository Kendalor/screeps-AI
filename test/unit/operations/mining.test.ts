// Mining's three channels in one file, because they are one capability: the miners, the haulers
// that carry what miners produce, and the container they drop into. The demand assertions are
// ported verbatim from systems/logistics.ts's tests and the structure ones from systems/mining.ts's
// — the formulas did not change, only their owner.
//
// Every case constructs the operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { buildCostMatrix, sourceRoadPath } from "../../../src/layouts/roads";
import { Mining } from "../../../src/operations/mining";
import { colonySnap, containerAt, openTerrain, snapCreep, snapCreeps, sourceAt } from "../../fixtures";

const mining = new Mining("W1N1");

// The last road tile adjacent to the source, derived independently from road
// pathing rather than a hardcoded coordinate.
function expectedSpot(anchor: { x: number; y: number }, source: { x: number; y: number }) {
  const cm = buildCostMatrix({ terrain: openTerrain(), structures: [] });
  return sourceRoadPath(anchor, source, cm).structurePos;
}

const minerRequests = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
  mining.desiredCreeps(snap).filter(r => r.memory.role === "miner");
const haulerRequests = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
  mining.desiredCreeps(snap).filter(r => r.memory.role === "hauler");

// Self-gating: whether an operation does anything is its own decision, made against the snapshot
// it is handed. operationsFor() gives every colony a Mining unconditionally, so a source-less room
// must produce a Mining that wants nothing rather than one that was never constructed.
describe("Mining on a colony with nothing to mine", () => {
  it("wants nothing through any channel", () => {
    const snap = colonySnap({ sources: [], containers: [], anchor: { x: 25, y: 25 }, controllerLevel: 3 });

    expect(mining.desiredCreeps(snap)).toEqual([]);
    expect(mining.structures(snap)).toEqual([]);
    expect(mining.intents(snap)).toEqual([]);
  });
});

describe("Mining.desiredCreeps — miners", () => {
  it("wants exactly one miner for a single source when no haulers are alive yet", () => {
    expect(minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }))).toHaveLength(1);
  });

  it("caps requests by live hauler count once a hauler exists", () => {
    // Default 300-energy body carries 2 WORK, so one source (target 6 WORK) wants 3 miners
    // once the cold-start floor no longer applies — but only one hauler is alive to collect.
    const snap = colonySnap({ sources: [sourceAt(20, 10)], creeps: snapCreeps("hauler", 1) });
    expect(minerRequests(snap)).toHaveLength(1);
  });

  // The cap is on total miner headcount, not on requests per tick: counting only requests would
  // let the colony re-spend the whole hauler allowance every tick and mine far past its collectors.
  it("counts live miners against the collector cap", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      creeps: [...snapCreeps("hauler", 1), ...snapCreeps("miner", 1)]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  it("caps requests by the source's open adjacent tiles, even with haulers to spare", () => {
    // An enclosed source with only one open tile can never seat more than one miner.
    const enclosed = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({ sources: [enclosed], creeps: snapCreeps("hauler", 5) });
    expect(minerRequests(snap)).toHaveLength(1);
  });

  it("asks for fewer, bigger miners as energy capacity grows", () => {
    const twoSources = [sourceAt(20, 10), sourceAt(30, 40)];
    const small = colonySnap({ sources: twoSources, creeps: snapCreeps("hauler", 5), energyCapacity: 300 });
    const large = colonySnap({ sources: twoSources, creeps: snapCreeps("hauler", 5), energyCapacity: 1000 });

    const workOf = (body: BodyPartConstant[]) => body.filter(p => p === WORK).length;
    expect(workOf(minerRequests(large)[0].body)).toBeGreaterThan(workOf(minerRequests(small)[0].body));
  });

  // The per-source deficit is the point of the change: a count could not tell a double-staffed
  // source from a bare one.
  it("asks only for the source no live miner is assigned to", () => {
    // One open tile each, so a single miner saturates a source and the only remaining demand is
    // the source nobody is on. A count could not tell these two apart.
    const covered = sourceAt(20, 10, "source_20_10", 1);
    const bare = sourceAt(30, 40, "source_30_40", 1);
    const snap = colonySnap({
      sources: [covered, bare],
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: covered.id } })]
    });

    const requests = minerRequests(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.sourceId).toBe(bare.id);
  });

  it("ignores a miner assigned to a source this colony does not have", () => {
    const source = sourceAt(20, 10);
    const snap = colonySnap({
      sources: [source],
      // Haulers for headroom: the collector cap counts every live miner, including the stray one.
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: "elsewhere" as Id<Source> } })]
    });

    expect(minerRequests(snap)[0].memory.sourceId).toBe(source.id);
  });

  it("returns nothing once every source is covered", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({
      sources: [source],
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: source.id } })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  // A miner deployed before this stage carries no sourceId (PRD §6). It still mines, so it must
  // count as cover for a source — not merely consume the collector cap while every source still
  // looks bare, which would stop miner demand entirely until it died of old age.
  it("treats a miner with no sourceId as cover rather than letting it starve demand", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({
      sources: [source],
      creeps: [...snapCreeps("hauler", 1), snapCreep("miner", { memory: {} })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  it("spreads unassigned miners across sources before asking for new ones", () => {
    const a = sourceAt(20, 10, "source_a", 1);
    const b = sourceAt(30, 40, "source_b", 1);
    const snap = colonySnap({
      sources: [a, b],
      // Two haulers of headroom, one legacy miner: it covers the first source, the second is bare.
      creeps: [...snapCreeps("hauler", 2), snapCreep("miner", { memory: {} })]
    });

    const requests = minerRequests(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.sourceId).toBe(b.id);
  });

  // The per-source WORK target and the body that fills it must be sized against the same context.
  // At 1000 energy the two disagree: a drop-miner body carries 6 WORK (target: 1 miner) but the
  // container-miner body actually sent carries 5 (target: 2). Sizing the target off the wrong body
  // under-staffs the source by a whole miner.
  it("sizes the per-source target against the same body it actually requests", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      containers: [containerAt(21, 10, 0)],
      energyCapacity: 1000,
      creeps: snapCreeps("hauler", 9)
    });

    const requests = minerRequests(snap);
    expect(requests[0].body.filter(p => p === WORK)).toHaveLength(5);
    expect(requests).toHaveLength(2);
  });

  it("stamps the requesting op on every request, so its creeps are identifiable next tick", () => {
    const [request] = minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }));

    expect(request.memory).toMatchObject({ role: "miner", home: "W1N1", op: "mining:W1N1" });
  });
});

describe("Mining.desiredCreeps — haulers", () => {
  it("wants no haulers when there is nothing to haul from", () => {
    expect(haulerRequests(colonySnap({ containers: [] }))).toEqual([]);
  });

  it("wants one hauler per active container", () => {
    expect(haulerRequests(colonySnap({ containers: [containerAt(10, 10, 500)], energyAvailable: 550 }))).toHaveLength(
      1
    );
    expect(
      haulerRequests(
        colonySnap({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 500)], energyAvailable: 550 })
      )
    ).toHaveLength(2);
  });

  it("ignores containers that are sitting empty", () => {
    expect(
      haulerRequests(
        colonySnap({ containers: [containerAt(10, 10, 500), containerAt(40, 40, 0)], energyAvailable: 550 })
      )
    ).toHaveLength(1);
  });

  it("wants no haulers when the colony cannot afford even one body", () => {
    expect(haulerRequests(colonySnap({ containers: [containerAt(10, 10, 500)], energyCapacity: 100 }))).toEqual([]);
  });

  it("returns nothing once the live haulers cover every filling container", () => {
    const snap = colonySnap({
      containers: [containerAt(10, 10, 500)],
      energyAvailable: 550,
      creeps: snapCreeps("hauler", 1)
    });

    expect(haulerRequests(snap)).toEqual([]);
  });

  it("stamps the same op as its miners — one operation owns both", () => {
    const snap = colonySnap({ containers: [containerAt(10, 10, 500)], energyAvailable: 550 });

    expect(haulerRequests(snap)[0].memory).toMatchObject({ role: "hauler", home: "W1N1", op: "mining:W1N1" });
  });
});

describe("Mining.structures", () => {
  it("declares a container on the last road tile next to each source", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3 });

    const spot = expectedSpot(anchor, source);
    expect(mining.structures(snap)).toContainEqual({ x: spot.x, y: spot.y, type: "container" });
  });

  it("declares a container per source", () => {
    const snap = colonySnap({
      anchor: { x: 25, y: 25 },
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      controllerLevel: 3
    });

    expect(mining.structures(snap).filter(s => s.type === "container")).toHaveLength(2);
  });

  // The gate moved out of building.ts and into the operation: an operation that cannot afford a
  // container does not ask for one, exactly as its creep demand is gated by current state.
  it("withholds its container below CONTAINERS_FROM_RCL", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 2,
      storageEnergy: 0,
      storageId: undefined
    });

    expect(mining.structures(snap)).toEqual([]);
  });

  it("declares nothing at RCL1, when the miner economy cannot be afforded yet", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 1
    });

    expect(mining.structures(snap)).toEqual([]);
  });

  it("declares a link instead of a container at RCL7", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 7 });

    const spot = expectedSpot(anchor, source);
    expect(mining.structures(snap)).toEqual([{ x: spot.x, y: spot.y, type: "link" }]);
  });

  // A spot that moves once the container exists makes building.ts demolish and
  // replace it forever.
  it("keeps declaring the same spot once the container is built there", () => {
    const base = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3
    });

    const [first] = mining.structures(base);
    const [second] = mining.structures({ ...base, structures: [first] });

    expect(second).toEqual(first);
  });

  it("declares nothing before an anchor is found", () => {
    const snap = colonySnap({ anchor: null, sources: [sourceAt(20, 10)], controllerLevel: 3 });

    expect(mining.structures(snap)).toEqual([]);
  });
});

describe("Mining.intents", () => {
  it("records each source's mining spot so roles can find it without re-pathing", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3 });

    const spot = expectedSpot(anchor, source);
    expect(mining.intents(snap)).toContainEqual({
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
    const snap = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      structures: [{ x: spot.x, y: spot.y, type: "container" }],
      containers: [container]
    });

    expect(mining.intents(snap)).toContainEqual(
      expect.objectContaining({ kind: "recordSourceSpot", source: source.id, container: container.id })
    );
  });

  it("plans nothing for a colony with no anchor yet", () => {
    const snap = colonySnap({ anchor: null, sources: [sourceAt(20, 10)], controllerLevel: 3 });

    expect(mining.intents(snap)).toEqual([]);
  });
});
