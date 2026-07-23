// Mining's three channels in one file, because they are one capability: the miners, the haulers
// that carry what miners produce, and the container they drop into. The demand assertions are
// ported verbatim from systems/logistics.ts's tests and the structure ones from systems/mining.ts's
// — the formulas did not change, only their owner.
//
// Every case constructs the operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import { buildCostMatrix, sourceRoadPath } from "../../../src/layouts/roads";
import { plannedObstacles } from "../../../src/layouts/goal";
import { stampLayout, type PlacedStructure } from "../../../src/layouts/stamp";
import type { GoalLayout } from "../../../src/layouts/sync";
import type { XY } from "../../../src/lib/geometry";
import { Mining } from "../../../src/operations/mining";
import { DEFAULT_PRIORITY } from "../../../src/spawn/request";
import { colonySnap, containerAt, openTerrain, snapCreep, snapCreeps, sourceAt } from "../../fixtures";

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
  // Miners lead now and are sized against the source alone: the per-source WORK target (6) divided
  // by the WORK a 300-energy body carries (2) is 3, and the source's 8 open tiles can seat them.
  // No hauler ceiling — hauler demand derives from miner output, not the other way round.
  it("wants enough miners to saturate a source's WORK target, regardless of haulers", () => {
    expect(minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }))).toHaveLength(3);
  });

  // Live miners are counted against the per-source target so the colony does not re-spend the whole
  // allowance every tick: two of the three wanted are already alive, so only one is still missing.
  it("asks only for the miners a source is still short", () => {
    const source = sourceAt(20, 10);
    const snap = colonySnap({
      sources: [source],
      creeps: snapCreeps("miner", 2, { memory: { sourceId: source.id, op: "mining:W1N1" } })
    });

    expect(minerRequests(snap)).toHaveLength(1);
  });

  it("stops asking once a source's WORK target is met", () => {
    const source = sourceAt(20, 10);
    const snap = colonySnap({
      sources: [source],
      creeps: snapCreeps("miner", 3, { memory: { sourceId: source.id, op: "mining:W1N1" } })
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
      creeps: [...snapCreeps("hauler", 5), snapCreep("miner", { memory: { sourceId: source.id } })]
    });

    expect(minerRequests(snap)).toEqual([]);
  });
});

// Haulers now derive from what the miners actually produce — the live miners' WORK converted to
// income, times the round trip to the drop-off — not a flat one-per-container count. These helpers
// build owned miners of a given WORK size so a test can dial income directly.
const wnMiner = (work: number, sourceId = "s") =>
  snapCreep("miner", { body: Array<BodyPartConstant>(work).fill(WORK), memory: { op: "mining:W1N1", sourceId } });
const wnMiners = (n: number, work: number) => Array.from({ length: n }, () => wnMiner(work));

describe("Mining.desiredCreeps — haulers", () => {
  // "No haulers without miners" is the structural rule: income is 0 with no producing miner, so the
  // target is 0 — even with a source, an anchor, and energy to spend.
  it("wants no haulers while no miner is producing", () => {
    expect(haulerRequests(colonySnap({ sources: [sourceAt(20, 10)], anchor: { x: 10, y: 10 } }))).toEqual([]);
  });

  // One 3-WORK miner is 6 energy/tick; anchor 10 tiles from the source is a 20-tick round trip, so
  // 120 energy piles up between visits — one hauler (4 CARRY × 50 = 200 capacity) covers it.
  it("wants one hauler for a single modest miner nearby", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(1, 3)
    });
    expect(haulerRequests(snap)).toHaveLength(1);
  });

  // Saturated income (two sources, 20 energy/tick capped) over the same trip piles 400 energy — two
  // haulers. Hauler capacity thus scales with miner output, which is the point.
  it("fields more haulers as miner output rises", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(2, 5) // 10 WORK -> 20 energy/tick, at the room cap
    });
    expect(haulerRequests(snap).length).toBeGreaterThanOrEqual(2);
  });

  // Same income, longer haul: a source far from the drop-off needs more carry capacity in flight, so
  // more haulers. Distance is a first-class input to the fleet size.
  it("fields more haulers as the haul distance grows", () => {
    const near = colonySnap({ sources: [sourceAt(15, 10)], anchor: { x: 10, y: 10 }, creeps: wnMiners(1, 3) });
    const far = colonySnap({ sources: [sourceAt(45, 40)], anchor: { x: 10, y: 10 }, creeps: wnMiners(1, 3) });

    expect(haulerRequests(far).length).toBeGreaterThan(haulerRequests(near).length);
  });

  // Income is clamped to the room's regen (2 sources × 10), so a miner surplus can never make the
  // colony ask for haulers to carry energy the sources cannot produce.
  it("clamps income to the room regen so surplus miners do not inflate the fleet", () => {
    const surplus = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(6, 5) // 60 WORK -> 120 raw, clamped to 20
    });
    const exact = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(2, 5) // 10 WORK -> 20, already at the cap
    });

    expect(haulerRequests(surplus).length).toBe(haulerRequests(exact).length);
  });

  it("wants no haulers when the colony cannot afford even one body", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(1, 3),
      energyCapacity: 100
    });
    expect(haulerRequests(snap)).toEqual([]);
  });

  it("asks only for the shortfall once some haulers are alive", () => {
    const before = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(2, 5)
    });
    const wanted = haulerRequests(before).length;
    expect(wanted).toBeGreaterThanOrEqual(2);

    const after = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: [...wnMiners(2, 5), ...snapCreeps("hauler", 1, { memory: { op: "mining:W1N1" } })]
    });
    expect(haulerRequests(after)).toHaveLength(wanted - 1);
  });

  it("stamps the same op as its miners — one operation owns both", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], anchor: { x: 10, y: 10 }, creeps: wnMiners(1, 3) });

    expect(haulerRequests(snap)[0].memory).toMatchObject({ role: "hauler", home: "W1N1", op: "mining:W1N1" });
  });
});

// Alternation is encoded in the priorities: each request is ranked by what number-in-its-role it
// would be (creeps already live of that role + its position in the deficit), and the roles interleave
// on that global count. The point is that ranking must count *live* creeps, not this tick's request
// index — otherwise every tick re-emits a top-priority miner and haulers never spawn (the measured
// cold-start deadlock: 5 miners, 0 haulers, drops rotting, at tick 3000).
describe("Mining.desiredCreeps — miner/hauler alternation", () => {
  const spawnOrder = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
    [...mining.desiredCreeps(snap)]
      .filter(r => r.memory.role === "miner" || r.memory.role === "hauler")
      .sort((a, b) => b.priority - a.priority)
      .map(r => r.memory.role);

  // The deadlock this prevents: several miners already alive, none of them yet drained by a hauler.
  // Ranking by request index alone would keep the remaining miners on top forever; ranking by live
  // count puts the first haulers (hauler #1, #2) ahead of the next miners (miner #4, #5, …).
  it("prioritises the first haulers over further miners once miners are already alive", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(3, 5) // three miners live, no haulers — the stall case
    });

    const order = spawnOrder(snap);
    expect(order.filter(r => r === "hauler").length).toBeGreaterThan(0);
    // Every hauler outranks every additional miner: no miner is spawned before the haulers the live
    // miners already warrant.
    const firstMinerIdx = order.indexOf("miner");
    const lastHaulerIdx = order.lastIndexOf("hauler");
    expect(lastHaulerIdx).toBeLessThan(firstMinerIdx);
  });

  // Before any miner is alive, only miners are asked for and one leads — "miners first, no haulers
  // without miners".
  it("asks for miners only until one is producing, and a miner always leads", () => {
    const snap = colonySnap({ sources: [sourceAt(20, 10)], anchor: { x: 10, y: 10 } });
    const order = spawnOrder(snap);
    expect(order[0]).toBe("miner");
    expect(new Set(order)).toEqual(new Set(["miner"]));
  });

  // Priorities never dip into the upgrader tier (60), so a large fleet cannot invert against upgraders.
  it("keeps miner/hauler priorities above the upgrader tier", () => {
    const snap = colonySnap({
      sources: [sourceAt(20, 10), sourceAt(20, 12)],
      anchor: { x: 10, y: 10 },
      creeps: wnMiners(3, 5)
    });
    for (const r of mining.desiredCreeps(snap)) {
      expect(r.priority).toBeGreaterThan(DEFAULT_PRIORITY.upgrader);
    }
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
    expect(mining.structures(snap).filter(s => s.type !== "road")).toEqual([
      { x: spot.x, y: spot.y, type: "link" }
    ]);
  });

  // The container is only worth having if haulers can reach it, and sourceRoadPath computes the
  // whole route anyway to find where the container goes.
  it("claims the road leading to its container, not just the container", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3 });

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
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3 });

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
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3 });

    const planned = plannedAt(anchor, 3, [source]);
    const withPlan = mining.structures(snap, planned);
    // The same room once the plan is actually standing: the derived container must not move.
    const built = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
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
      controllerLevel: 3
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
