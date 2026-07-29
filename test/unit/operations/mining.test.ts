// Mining's two channels in one file, because they are one capability: the miners and the container
// they drop into. Transport off the source is Logistics' job now (see operations/logistics.ts) —
// Mining no longer requests haulers at all.
//
// Every case constructs the operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import { buildCostMatrix, sourceRoadPath } from "../../../src/layouts/roads";
import { plannedObstacles } from "../../../src/layouts/goal";
import { stampLayout, type PlacedStructure } from "../../../src/layouts/stamp";
import type { GoalLayout } from "../../../src/layouts/sync";
import type { XY } from "../../../src/lib/geometry";
import { roleDef } from "../../../src/behaviors/roles";
import { Mining } from "../../../src/operations/mining";
import { colonySnap, containerAt, openTerrain, remoteSourceAt, scouted, scoutTarget, snapCreep, snapCreeps, sourceAt, spawn } from "../../fixtures";
import type { Intent } from "../../../src/intents/types";

const GOAL = GOAL_JSON as GoalLayout;

const mining = new Mining("W1N1");

// The last road tile adjacent to the source, derived independently from road pathing rather than a
// hardcoded coordinate. Pathed against the bunker stamp exactly as Mining does — a built-only
// matrix would route through ground the layout occupies and disagree with production.
function expectedRoute(anchor: XY, source: XY, rcl = 3) {
  const planned = stampLayout(plannedObstacles(GOAL, rcl, anchor, [source]), anchor);
  const cm = buildCostMatrix({ terrain: openTerrain(), structures: planned });
  return sourceRoadPath(anchor, source, cm);
}

const expectedSpot = (anchor: XY, source: XY, rcl = 3) => expectedRoute(anchor, source, rcl).structurePos;

// The baseline planBuilding seeds its operation poll with.
const plannedAt = (anchor: XY, rcl: number, sources: XY[]) =>
  stampLayout(plannedObstacles(GOAL, rcl, anchor, sources), anchor);

const minerRequests = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
  mining.desiredCreeps(snap).filter(r => r.memory.role === "miner");

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

// A miner's cover is its WORK, not its head: the quota targets WORK_PER_SOURCE (6) WORK per source.
// `mnMiner(work)` builds a live miner of a given WORK so a test dials cover directly, and `satMiner`
// is one that saturates a source on its own (6 WORK) — the shape "one miner covers this source"
// tests want, which the 1-WORK fixture default no longer expresses.
const mnMiner = (work: number, over: Parameters<typeof snapCreep>[1] = {}) =>
  snapCreep("miner", { ...over, body: Array<BodyPartConstant>(work).fill(WORK), memory: over.memory });
const satMiner = (over: Parameters<typeof snapCreep>[1] = {}) => mnMiner(6, over);

describe("Mining.desiredCreeps — miners", () => {
  // Miners lead now and are sized against the source alone: the per-source WORK target (6) divided
  // by the WORK a 300-energy body carries (2) is 3, and the source's 8 open tiles can seat them.
  // No hauler ceiling — hauler demand derives from miner output, not the other way round.
  it("wants enough miners to saturate a source's WORK target, regardless of haulers", () => {
    expect(minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }))).toHaveLength(3);
  });

  // Live WORK is counted against the per-source WORK target so the colony does not re-spend the whole
  // allowance every tick: two 2-WORK miners already cover 4 of the 6 WORK, so only one more is short.
  it("asks only for the miners a source is still short", () => {
    const source = sourceAt(20, 10);
    const snap = colonySnap({
      sources: [source],
      creeps: [mnMiner(2, { memory: { sourceId: source.id, op: "mining:W1N1" } }),
               mnMiner(2, { memory: { sourceId: source.id, op: "mining:W1N1" } })]
    });

    expect(minerRequests(snap)).toHaveLength(1);
  });

  it("stops asking once a source's WORK target is met", () => {
    const source = sourceAt(20, 10);
    // Three 2-WORK miners = 6 WORK, the full per-source target.
    const snap = colonySnap({
      sources: [source],
      creeps: [mnMiner(2, { memory: { sourceId: source.id, op: "mining:W1N1" } }),
               mnMiner(2, { memory: { sourceId: source.id, op: "mining:W1N1" } }),
               mnMiner(2, { memory: { sourceId: source.id, op: "mining:W1N1" } })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  it("caps requests by the source's open adjacent tiles", () => {
    // An enclosed source with only one open tile can never seat more than one miner.
    const enclosed = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({ sources: [enclosed] });
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
    // One open tile each, so a single saturating miner covers a source and the only remaining demand
    // is the source nobody is on. A count could not tell these two apart.
    const covered = sourceAt(20, 10, "source_20_10", 1);
    const bare = sourceAt(30, 40, "source_30_40", 1);
    const snap = colonySnap({
      sources: [covered, bare],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: covered.id } })]
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
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: source.id } })]
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
      creeps: [...snapCreeps("hauler", 1), satMiner({ memory: {} })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  it("spreads unassigned miners across sources before asking for new ones", () => {
    const a = sourceAt(20, 10, "source_a", 1);
    const b = sourceAt(30, 40, "source_b", 1);
    const snap = colonySnap({
      sources: [a, b],
      // Two haulers of headroom, one saturating legacy miner: its 6 WORK fully covers one source's
      // target, leaving none of its cover for the second, which stays bare.
      creeps: [...snapCreeps("hauler", 2), satMiner({ memory: {} })]
    });

    const requests = minerRequests(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.sourceId).toBe(b.id);
  });

  // The per-source WORK target and the body that fills it must be sized against the same context.
  // At 1000 energy a container-miner body affords the full 6-WORK ceiling, so one miner alone
  // saturates the source's target instead of needing a second body to cover the gap.
  it("sizes the per-source target against the same body it actually requests", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      containers: [containerAt(21, 10, 0)],
      energyCapacity: 1000,
      creeps: snapCreeps("hauler", 9)
    });

    const requests = minerRequests(snap);
    expect(requests[0].body.filter(p => p === WORK)).toHaveLength(6);
    expect(requests).toHaveLength(1);
  });

  it("stamps the requesting op on every request, so its creeps are identifiable next tick", () => {
    const [request] = minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }));

    expect(request.memory).toMatchObject({ role: "miner", home: "W1N1", op: "mining:W1N1" });
  });

  // The multi-operation bug: filtering by role alone would count another Mining's miners. A miner
  // stamped for a different op must not satisfy this operation's demand.
  it("ignores a miner owned by a different operation", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({
      sources: [source],
      creeps: [
        ...snapCreeps("hauler", 5),
        // Assigned to this source but owned by someone else — not our cover.
        snapCreep("miner", { memory: { op: "mining:W9N9", sourceId: source.id } })
      ]
    });

    // Still wants its own miner for the source, since the foreign one does not count.
    expect(minerRequests(snap)).toHaveLength(1);
  });

  // A creep with no op is fair game for any matching operation (attrition clears it), so it still
  // counts as cover — same rule as an unassigned sourceId.
  it("counts an unowned miner as its own", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const snap = colonySnap({
      sources: [source],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: source.id } })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });

  // The miner-swarm regression: the quota targets WORK, not heads. A source already holding its full
  // WORK_PER_SOURCE (6) is satisfied however that WORK is packaged — three 2-WORK bodies, two 3-WORK,
  // or one 6-WORK — so a fleet spawned small at low capacity is never topped up as bodies grow. The
  // old headcount target could not see this: it kept asking until the *head* count matched a target
  // computed from the current body, stacking 9 three-WORK miners (27 WORK) on two sources that needed
  // ~12.
  it("stops at the WORK target no matter how the WORK is packaged", () => {
    const source = sourceAt(20, 10);
    const cases = [
      [mnMiner(2), mnMiner(2), mnMiner(2)], // three small
      [mnMiner(3), mnMiner(3)], // two medium
      [mnMiner(6)] // one big
    ];
    for (const pack of cases) {
      const creeps = pack.map(m => ({ ...m, memory: { ...m.memory, sourceId: source.id, op: "mining:W1N1" } }));
      expect(minerRequests(colonySnap({ sources: [source], creeps }))).toEqual([]);
    }
  });

  // Total requested + live WORK never exceeds the target across the capacity ramp — the property the
  // swarm violated. A room that spawned six 2-WORK miners (12 WORK, the target for two sources) asks
  // for zero more once capacity grows enough to afford 3-WORK bodies, rather than adding to reach a
  // new headcount.
  it("does not top up an already-saturated fleet as body size grows", () => {
    const a = sourceAt(20, 10, "src_a");
    const b = sourceAt(30, 40, "src_b");
    // Six 2-WORK miners, three per source: 6 WORK each source, both fully covered.
    const creeps = [
      ...Array.from({ length: 3 }, () => mnMiner(2, { memory: { sourceId: a.id, op: "mining:W1N1" } })),
      ...Array.from({ length: 3 }, () => mnMiner(2, { memory: { sourceId: b.id, op: "mining:W1N1" } }))
    ];
    // Capacity now affords bigger bodies, but the sources are already at target.
    const snap = colonySnap({ sources: [a, b], energyCapacity: 550, creeps });

    expect(minerRequests(snap)).toEqual([]);
  });
});

const remoteMinerRequests = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
  mining.desiredCreeps(snap).filter(r => r.memory.role === "miner" && r.targetRoom !== "W1N1");

describe("Mining.desiredCreeps — remote miners", () => {
  // A local source already fully staffed (so the local-first gate is open) plus one selected remote
  // source: Mining asks for miners aimed at the remote room and stamped with the remote source id.
  it("requests miners for a selected remote source, targeted at the remote room", () => {
    const local = sourceAt(20, 10, "local", 1);
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [remote],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    const requests = remoteMinerRequests(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.targetRoom).toBe("W2N1");
      expect(r.memory.sourceId).toBe(remote.id);
      expect(r.memory.op).toBe("mining:W1N1");
    }
  });

  // Invariant #3: a remote can never starve the home room. While any local source is still short a
  // miner, no remote request is emitted at all.
  it("staffs no remote source while a local source is still under-staffed", () => {
    const bareLocal = sourceAt(20, 10, "local", 1); // no miner assigned -> local deficit
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const snap = colonySnap({ sources: [bareLocal], remoteSources: [remote], creeps: snapCreeps("hauler", 5) });

    expect(remoteMinerRequests(snap)).toEqual([]);
    // and it is still asking for the LOCAL miner
    expect(minerRequests(snap).every(r => r.targetRoom === "W1N1")).toBe(true);
  });

  // Danger response is age-out, not retreat: a hostile remote just stops new miner requests.
  it("skips a remote source whose room is in danger", () => {
    const local = sourceAt(20, 10, "local", 1);
    const danger = remoteSourceAt(25, 25, "W2N1", { distance: 60, danger: 1 });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [danger],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    expect(remoteMinerRequests(snap)).toEqual([]);
  });
});

// Every request now comes from a flat, uniform priority — no interleave, no hauler channel.
describe("Mining.desiredCreeps — priority", () => {
  it("asks only for miners, all at the miner role's priority", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 }
    });

    const requests = mining.desiredCreeps(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.memory.role).toBe("miner");
      expect(r.priority).toBe(roleDef("miner")!.priority);
    }
  });
});

describe("Mining.structures", () => {
  it("declares a container on the last road tile next to each source", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const spot = expectedSpot(anchor, source);
    expect(mining.structures(snap)).toContainEqual({ x: spot.x, y: spot.y, type: "container" });
  });

  it("declares a container per source", () => {
    const snap = colonySnap({
      anchor: { x: 25, y: 25 },
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      controllerLevel: 3,
      energyCapacity: 800
    });

    expect(mining.structures(snap).filter(s => s.type === "container")).toHaveLength(2);
  });

  // The gate is on energy capacity, not RCL: an operation that cannot afford a container does not
  // ask for one, exactly as its creep demand is gated by current state. 549 = one short of the gate.
  it("withholds its container below CONTAINERS_FROM_ENERGY_CAPACITY", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3,
      energyCapacity: 549,
      storageEnergy: 0,
      storageId: undefined
    });

    expect(mining.structures(snap)).toEqual([]);
  });

  it("declares nothing at RCL3 while capacity is still bootstrap-low", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3,
      energyCapacity: 300
    });

    expect(mining.structures(snap)).toEqual([]);
  });

  it("declares a link instead of a container at RCL7", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 7, energyCapacity: 800 });

    const spot = expectedSpot(anchor, source);
    expect(mining.structures(snap).filter(s => s.type !== "road")).toEqual([
      { x: spot.x, y: spot.y, type: "link" }
    ]);
  });

  // The container is only worth having if haulers can reach it, and sourceRoadPath computes the
  // whole route anyway to find where the container goes.
  it("claims the road leading to its container, not just the container", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const route = expectedRoute(anchor, source);
    // Handed the same baseline expectedRoute paths against, as planBuilding's poll does.
    const roads = mining.structures(snap, plannedAt(anchor, 3, [source])).filter(s => s.type === "road");

    expect(roads.length).toBeGreaterThan(0);
    // Every claimed road lies on the route.
    const onRoute = new Set(route.path.map(p => `${p.x},${p.y}`));
    for (const r of roads) expect(onRoute.has(`${r.x},${r.y}`)).toBe(true);
    // The container tile is the route's last step and is never also claimed as road.
    expect(roads).not.toContainEqual({ x: route.structurePos.x, y: route.structurePos.y, type: "road" });
  });

  // Two structures on one tile is not a plan planBuilding can execute.
  it("never claims a tile the layout or a sibling already planned", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const planned = plannedAt(anchor, 3, [source]);
    const claimed = mining.structures(snap, planned);

    const takenTiles = new Set(planned.map(p => `${p.x},${p.y}`));
    for (const c of claimed) expect(takenTiles.has(`${c.x},${c.y}`)).toBe(false);
    // And no duplicates within its own claim.
    const keys = claimed.map(c => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // A route computed over built-only tiles runs through ground the layout will occupy, so the
  // container position shifts the tick that structure goes up — and a moved position makes
  // planBuilding demolish and re-place the container forever.
  it("paths around planned structures, not only built ones", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const planned = plannedAt(anchor, 3, [source]);
    const withPlan = mining.structures(snap, planned);
    // The same room once the plan is actually standing: the derived container must not move.
    const built = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      energyCapacity: 800,
      structures: planned.map(p => ({ x: p.x, y: p.y, type: p.type }))
    });

    const containerOf = (s: PlacedStructure[]) => s.find(p => p.type === "container");
    expect(containerOf(withPlan)).toEqual(containerOf(mining.structures(built, planned)));
  });

  // A spot that moves once the container exists makes building.ts demolish and
  // replace it forever.
  it("keeps declaring the same spot once the container is built there", () => {
    const base = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3,
      energyCapacity: 800
    });

    const containerOf = (snap: typeof base) =>
      mining.structures(snap).find(p => p.type === "container");

    const first = containerOf(base)!;
    const second = containerOf({ ...base, structures: [first] });

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

  // This channel runs every tick now. Re-emitting an identical write 1500 times per creep lifetime
  // is pure waste, and the base class's rule is that the operation decides — only it knows which of
  // its writes are idempotent.
  it("emits nothing once the recorded spot already matches", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const spot = expectedSpot(anchor, source);
    const snap = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      sourceMemory: { [source.id]: { spot: { x: spot.x, y: spot.y } } }
    });

    expect(mining.intents(snap)).toEqual([]);
  });

  it("still emits when a container appears on an already-recorded spot", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const spot = expectedSpot(anchor, source);
    const container = containerAt(spot.x, spot.y);
    const snap = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      containers: [container],
      // Spot recorded, container id not yet — the one case a write still has something to add.
      sourceMemory: { [source.id]: { spot: { x: spot.x, y: spot.y } } }
    });

    expect(mining.intents(snap)).toContainEqual(
      expect.objectContaining({ kind: "recordSourceSpot", container: container.id })
    );
  });

  it("emits nothing once both spot and container are recorded", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const spot = expectedSpot(anchor, source);
    const container = containerAt(spot.x, spot.y);
    const snap = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      containers: [container],
      sourceMemory: { [source.id]: { spot: { x: spot.x, y: spot.y }, containerId: container.id } }
    });

    expect(mining.intents(snap)).toEqual([]);
  });
});

// Step 8: autonomous remote selection. Mining emits a setRemotes intent on its throttle tick, driven by
// pickRemotes over the scouted neighbours — no hand-seed. Off-tick it's silent so the cached set is stable.
describe("Mining.intents — remote selection", () => {
  const setRemotesOf = (snap: Parameters<Mining["intents"]>[0]) =>
    mining.intents(snap).filter((i: Intent): i is Extract<Intent, { kind: "setRemotes" }> => i.kind === "setRemotes");

  it("emits setRemotes on the throttle tick, selecting a scouted profitable neighbour", () => {
    const snap = colonySnap({
      tick: 100, // a multiple of remoteSelectionEvery (100)
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()], // headroom: an empty spawn network has capacity for a remote miner's body
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    const [intent] = setRemotesOf(snap);
    expect(intent).toBeDefined();
    expect(intent.room).toBe("W1N1");
    expect(intent.remotes.map(r => r.room)).toContain("W2N1");
  });

  it("stays silent off the throttle tick", () => {
    const snap = colonySnap({
      tick: 101, // not a multiple of 100
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      scoutTargets: [scoutTarget("W2N1", scouted())]
    });

    expect(setRemotesOf(snap)).toEqual([]);
  });

  it("stays silent when no neighbour pays off (no noisy empty write every throttle tick)", () => {
    const snap = colonySnap({
      tick: 100,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      scoutTargets: [] // nothing scouted
    });

    expect(setRemotesOf(snap)).toEqual([]);
  });

  it("stays silent with no spawns at all — no capacity to staff anything new", () => {
    const snap = colonySnap({
      tick: 100,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [], // no spawn network: zero capacity, gate must fail closed
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    expect(setRemotesOf(snap)).toEqual([]);
  });

  it("stays silent when the spawn network is already saturated by living creeps", () => {
    // One spawn sustains PARTS_PER_SPAWN (500) parts. Fill it past capacity with a pile of live
    // creeps so even a small remote-miner body can't fit underneath — headroom must read false.
    const saturating = snapCreeps(50, i => snapCreep({ id: `sat_${i}` as Id<Creep>, role: "upgrader", body: Array(10).fill(WORK) }));
    const snap = colonySnap({
      tick: 100,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      creeps: saturating,
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    expect(setRemotesOf(snap)).toEqual([]);
  });
});
