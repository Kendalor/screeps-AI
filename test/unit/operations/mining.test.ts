// Mining's two channels in one file, because they are one capability: the miners and the container
// they drop into. Transport off the source is Logistics' job now (see operations/logistics.ts) —
// Mining no longer requests haulers at all.
//
// Every case constructs the operation directly and hands it a snapshot: no Game mock, no Colony.

import { beforeEach, describe, expect, it } from "vitest";
import type { XY } from "../../../src/lib/geometry";
import { roleDef } from "../../../src/behaviors/roles";
import { REMOTE_MINER_PRIORITY } from "../../../src/behaviors/roles/miner";
import { Mining } from "../../../src/operations/mining";
import { findPath, resetFindPathCacheForTests, type FindPath } from "../../../src/construction/planner";
import type { PlacedStructure } from "../../../src/construction/stamp";
import { colonySnap, containerAt, openTerrain, remoteSourceAt, scouted, scoutTarget, snapCreep, snapCreeps, sourceAt, spawn } from "../../fixtures";
import { stubPathFinderSingleRoom } from "../../constants";
import type { ColonySnapshot } from "../../../src/snapshot/types";
import type { Intent } from "../../../src/intents/types";

const mining = new Mining("W1N1");

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
});

// Every test drives Mining.structures()/intents() through the real planner findPath (real
// PathFinder.search, single-room, stubbed via stubPathFinderSingleRoom) — the same seam production
// code uses, curried against whatever snapshot the test builds.
const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

// The last road tile adjacent to the source, derived independently by driving the real findPath against
// a snapshot with no other operations' claims yet — a built-only matrix would route through ground the
// layout occupies and disagree with production.
function expectedRoute(anchor: XY, source: XY, rcl = 3) {
  const snap = colonySnap({ anchor, sources: [source], controllerLevel: rcl, terrain: openTerrain() });
  const anchorPos = new RoomPosition(anchor.x, anchor.y, snap.name);
  const sourcePos = new RoomPosition(source.x, source.y, snap.name);
  return findPathFor(snap)(anchorPos, sourcePos, 1);
}

const expectedSpot = (anchor: XY, source: XY, rcl = 3) => expectedRoute(anchor, source, rcl).structurePos;

const minerRequests = (snap: Parameters<Mining["desiredCreeps"]>[0]) =>
  mining.desiredCreeps(snap).filter(r => r.memory.role === "miner");

// Self-gating: whether an operation does anything is its own decision, made against the snapshot
// it is handed. operationsFor() gives every colony a Mining unconditionally, so a source-less room
// must produce a Mining that wants nothing rather than one that was never constructed.
describe("Mining on a colony with nothing to mine", () => {
  it("wants nothing through any channel", () => {
    const snap = colonySnap({ sources: [], containers: [], anchor: { x: 25, y: 25 }, controllerLevel: 3 });

    expect(mining.desiredCreeps(snap)).toEqual([]);
    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
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

  it("pins local miner requests to this colony's own spawn", () => {
    const requests = minerRequests(colonySnap({ sources: [sourceAt(20, 10)] }));
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.spawnRoom).toBe("W1N1");
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
      // Pinned to the requesting colony even though targetRoom is the remote — only the ONE colony
      // that selected this remote ever requests a miner for it (see spawnRoom's doc in mining.ts and
      // spawn/request.ts). Without this a remote-miner request could be opportunistically fulfilled by
      // an unrelated colony's spawn.
      expect(r.spawnRoom).toBe("W1N1");
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

  // Same age-out (not retreat) response as danger: a room reserved by someone else (e.g. an
  // Invader-core reservation) stops new miner requests too, even with zero live hostile creeps.
  it("skips a remote source whose room is reserved by someone else", () => {
    const local = sourceAt(20, 10, "local", 1);
    const reserved = remoteSourceAt(25, 25, "W2N1", { distance: 60, reservedBy: "Invader" });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [reserved],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    expect(remoteMinerRequests(snap)).toEqual([]);
  });

  // Regression: reservedBy must never suppress requests for a room WE reserve — only a foreign
  // reservation should pause staffing (see remoteSources.test.ts's join invariant).
  it("still requests a remote miner for a room reserved by us", () => {
    const local = sourceAt(20, 10, "local", 1);
    const ours = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: true, reservedBy: undefined });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [ours],
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    expect(remoteMinerRequests(snap).length).toBeGreaterThan(0);
  });

  // A remote miner's body must be sized off its OWN room's reserved state, never the home room's
  // container/link/site state — that was the original bug (a shared bodyContext(colony) leaked the home
  // room's structures into every remote request).
  it("sizes an unreserved remote source's WORK to 3, whatever the home room's container state", () => {
    const local = sourceAt(20, 10, "local", 1);
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: false });
    const snap = colonySnap({
      sources: [local],
      containers: [containerAt(21, 11)], // home room's source has a container — must not leak into remote sizing
      remoteSources: [remote],
      energyCapacity: 5000,
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    const requests = remoteMinerRequests(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.body.filter(p => p === WORK).length).toBe(3);
  });

  it("sizes a reserved remote source's WORK to 6, the same target as a local source", () => {
    const local = sourceAt(20, 10, "local", 1);
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: true });
    const snap = colonySnap({
      sources: [local],
      containers: [], // home room has no container — must not leak into remote sizing either
      remoteSources: [remote],
      energyCapacity: 5000,
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    const requests = remoteMinerRequests(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.body.filter(p => p === WORK).length).toBe(6);
  });

  it("gives a remote miner WORK:MOVE 1:1 (no road home assumed), unlike a local miner's cheaper ratio", () => {
    const local = sourceAt(20, 10, "local", 1);
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: true });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [remote],
      energyCapacity: 5000,
      creeps: [...snapCreeps("hauler", 5), satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } })]
    });

    const requests = remoteMinerRequests(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      const work = r.body.filter(p => p === WORK).length;
      const move = r.body.filter(p => p === MOVE).length;
      expect(move).toBe(work);
    }
  });

  // The request quota (wantedWork) must track the lower unreserved target too, or Mining keeps asking
  // for a second miner trying to reach the full 6-WORK quota — overstaffing an unreserved source 2x.
  it("stops asking for more miners once an unreserved remote source has its 3-WORK quota covered", () => {
    const local = sourceAt(20, 10, "local", 1);
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: false, openTiles: 8 });
    const snap = colonySnap({
      sources: [local],
      remoteSources: [remote],
      energyCapacity: 5000,
      creeps: [
        ...snapCreeps("hauler", 5),
        satMiner({ memory: { sourceId: local.id, op: "mining:W1N1" } }),
        mnMiner(3, { memory: { sourceId: remote.id, op: "mining:W1N1" } }) // already covers the 3-WORK quota
      ]
    });

    expect(remoteMinerRequests(snap)).toEqual([]);
  });
});

// Local requests come from a flat, uniform priority (roleDef("miner").priority) — no interleave, no
// hauler channel. Remote requests use a separately lower priority (REMOTE_MINER_PRIORITY) — see the
// "remote miner priority" describe block below for why: spawn-queue pressure should throttle remote
// mining first, rather than pickRemotes evicting (and orphaning/demolishing) an already-built source's
// claim just because spawn load spiked for a tick.
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

describe("Mining.desiredCreeps — remote miner priority", () => {
  it("requests a remote miner at REMOTE_MINER_PRIORITY, below local miner's priority", () => {
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
      expect(r.priority).toBe(REMOTE_MINER_PRIORITY);
      expect(r.priority).toBeLessThan(roleDef("miner")!.priority);
    }
  });

  it("still requests the LOCAL miner at the higher local priority even in the same colony as a selected remote", () => {
    const bareLocal = sourceAt(20, 10, "local", 1); // no miner assigned -> local deficit
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const snap = colonySnap({ sources: [bareLocal], remoteSources: [remote] });

    // Local-first gate means only local requests exist this tick, but confirms they're unaffected by
    // the remote source's mere presence in colony.remoteSources.
    const requests = minerRequests(snap);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.priority).toBe(roleDef("miner")!.priority);
  });
});

describe("Mining.structures", () => {
  it("declares a container on the last road tile next to each source", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const spot = expectedSpot(anchor, source);
    expect(mining.structures(snap, findPathFor(snap))).toContainEqual({
      x: spot.x,
      y: spot.y,
      type: "container",
      sourceId: source.id
    });
  });

  it("declares a container per source", () => {
    const snap = colonySnap({
      anchor: { x: 25, y: 25 },
      sources: [sourceAt(20, 10), sourceAt(30, 40)],
      controllerLevel: 3,
      energyCapacity: 800
    });

    expect(mining.structures(snap, findPathFor(snap)).filter(s => s.type === "container")).toHaveLength(2);
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

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
  });

  it("declares nothing at RCL3 while capacity is still bootstrap-low", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      sources: [sourceAt(20, 10)],
      controllerLevel: 3,
      energyCapacity: 300
    });

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
  });

  it("declares a link instead of a container at RCL7", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 7, energyCapacity: 800 });

    const spot = expectedSpot(anchor, source, 7);
    expect(mining.structures(snap, findPathFor(snap)).filter(s => s.type !== "road")).toEqual([
      { x: spot.x, y: spot.y, type: "link", sourceId: source.id }
    ]);
  });

  // The container is only worth having if haulers can reach it, and findPath computes the whole
  // route anyway to find where the container goes.
  it("claims the road leading to its container, not just the container", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const route = expectedRoute(anchor, source);
    const roads = mining.structures(snap, findPathFor(snap)).filter(s => s.type === "road");

    expect(roads.length).toBeGreaterThan(0);
    // Every claimed road lies on the route.
    const onRoute = new Set(route.path.map(p => `${p.x},${p.y}`));
    for (const r of roads) expect(onRoute.has(`${r.x},${r.y}`)).toBe(true);
    // The container tile is the route's last step and is never also claimed as road.
    expect(roads).not.toContainEqual({ x: route.structurePos.x, y: route.structurePos.y, type: "road" });
  });

  // Placement priority within a type falls back to claim order (see construction/planner.ts's stable sort),
  // so the order roads are claimed in is the order their sites get placed in. Claiming source-outward
  // means a builder paves the tiles nearest the source first, not the ones next to the anchor.
  it("claims road tiles source-outward, nearest the container first", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const roads = mining.structures(snap, findPathFor(snap)).filter(s => s.type === "road");
    expect(roads.length).toBeGreaterThan(1);

    // The first claimed road tile must be closer (or equally close) to the source than the last —
    // the reversed, source-outward order, not the old anchor-outward one.
    const toSource = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - source.x), Math.abs(p.y - source.y));
    expect(toSource(roads[0])).toBeLessThan(toSource(roads[roads.length - 1]));
  });

  // No duplicate tiles within Mining's own claim for a single source — consolidate()'s cross-operation
  // dedup/type-precedence is now the planner's own concern (see construction/planner.test.ts's
  // "consolidate" coverage), not something structures() needs to guard against itself.
  it("never claims the same tile twice within a single source's route", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });

    const claimed = mining.structures(snap, findPathFor(snap));
    const keys = claimed.map(c => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("paths around the bunker layout, not only built structures", () => {
    const anchor = { x: 10, y: 10 };
    const source = sourceAt(20, 10);
    const snap = colonySnap({ anchor, sources: [source], controllerLevel: 3, energyCapacity: 800 });
    const withPlan = mining.structures(snap, findPathFor(snap));

    // The same room once the plan is actually standing: the derived container must not move.
    const built = colonySnap({
      anchor,
      sources: [source],
      controllerLevel: 3,
      energyCapacity: 800,
      structures: withPlan.map(p => ({ x: p.x, y: p.y, type: p.type }))
    });

    const containerOf = (s: PlacedStructure[]) => s.find(p => p.type === "container");
    expect(containerOf(withPlan)).toEqual(containerOf(mining.structures(built, findPathFor(built))));
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

    const containerOf = (snap: ColonySnapshot) =>
      mining.structures(snap, findPathFor(snap)).find(p => p.type === "container");

    const first = containerOf(base)!;
    const second = containerOf({ ...base, structures: [first] });

    expect(second).toEqual(first);
  });

  it("declares nothing before an anchor is found", () => {
    const snap = colonySnap({ anchor: null, sources: [sourceAt(20, 10)], controllerLevel: 3 });

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
  });
});

// A remote route reuses the already-computed cross-room PathFinder path cached on the source (see
// remote-mining-progress/construction plan) instead of a local-only cost matrix, and only claims while
// the remote room actually has vision this tick.
describe("Mining.structures — remote sources", () => {
  const anchor = { x: 10, y: 10 };
  const route = [
    { room: "W1N1", x: 11, y: 10 }, // home-room portion of the path
    { room: "W2N1", x: 2, y: 10 },
    { room: "W2N1", x: 1, y: 10 } // last tile: the container spot, range 1 of the source
  ];

  it("claims a container and road for a remote source's cached route when the room is visible", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    const claims = mining.structures(snap, findPathFor(snap));
    expect(claims).toContainEqual({ x: 1, y: 10, room: "W2N1", type: "container", sourceId: source.id });
    expect(claims).toContainEqual({ x: 11, y: 10, room: "W1N1", type: "road", sourceId: source.id });
    expect(claims).toContainEqual({ x: 2, y: 10, room: "W2N1", type: "road", sourceId: source.id });
    // The container tile itself is never also claimed as a road.
    expect(claims.filter(c => c.type === "road")).toHaveLength(2);
  });

  // A route cached before remotePath.ts's exit-tile exclusion existed (or one that just never gets
  // recomputed for a long time — the cache only refreshes on the throttled setRemotes tick) can still
  // have an exit tile baked in. Skipping it here too means that stale cache self-heals immediately,
  // rather than leaving the source's whole group permanently "incomplete" for gateSourceGroups.
  it("never claims a road on a room's exit tile, even if the cached route still contains one", () => {
    const routeWithExit = [
      { room: "W1N1", x: 11, y: 10 },
      { room: "W1N1", x: 49, y: 10 }, // exit tile, W1N1 side
      { room: "W2N1", x: 0, y: 10 }, // exit tile, W2N1 side
      { room: "W2N1", x: 1, y: 10 }
    ];
    const source = remoteSourceAt(2, 10, "W2N1", { route: routeWithExit });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    const claims = mining.structures(snap, findPathFor(snap));
    expect(claims.some(c => c.x === 49 && c.room === "W1N1")).toBe(false);
    expect(claims.some(c => c.x === 0 && c.room === "W2N1")).toBe(false);
    expect(claims.filter(c => c.type === "road")).toHaveLength(1);
  });

  it("claims nothing for a remote source with no cached route yet", () => {
    const source = remoteSourceAt(2, 10, "W2N1");
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
  });

  // Danger/reservedBy no longer withholds the claim (see construction/planner.ts's unsafeRemoteRooms, which
  // now separately stops a site actually going up or a builder being dispatched into the room): dropping
  // the claim here demolished the whole route, home-room leg included, the instant danger/reservation
  // flickered on for even one tick — see mining.ts's structures() comment for the full incident.
  it("still claims a route's tiles for a remote source in a room reserved by the Invader NPC", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route, reservedBy: "Invader" });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    expect(mining.structures(snap, findPathFor(snap))).not.toEqual([]);
  });

  it("still claims a route's tiles for a remote source in a room reserved by another player", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route, reservedBy: "SomePlayer" });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    expect(mining.structures(snap, findPathFor(snap))).not.toEqual([]);
  });

  it("still claims a route's tiles for a remote source in a dangerous room", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route, danger: 1 });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    expect(mining.structures(snap, findPathFor(snap))).not.toEqual([]);
  });

  it("claims a route's road tiles but not its container when the remote room has no vision this tick", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: {} // W2N1 absent: no vision this tick
    });

    // Losing vision of the remote room (e.g. an invader killing the creep standing there) must not drop
    // the home-room leg of the route — that leg is always visible and doesn't need remote vision at all.
    // Dropping it made building.ts read an already-built home-room road as stale and demolish it, only to
    // have it re-claimed (and re-sited) the moment vision returned.
    const claims = mining.structures(snap, findPathFor(snap));
    expect(claims).toContainEqual({ x: 11, y: 10, room: "W1N1", type: "road", sourceId: source.id });
    expect(claims).toContainEqual({ x: 2, y: 10, room: "W2N1", type: "road", sourceId: source.id });
    expect(claims.some(c => c.type === "container")).toBe(false);
  });

  // Room-keyed claims: Mining's own emission still tags a remote tile with its real room even when its
  // (x,y) happens to collide with a home-room coordinate — cross-operation dedup by room+x+y (not just
  // x+y) is now the planner's consolidate() concern (see construction/planner.test.ts), but the raw
  // claim shape this asserts is still Mining's own to get right.
  it("tags a remote claim with its own room even when its (x,y) collides with a home-room coordinate", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    const claims = mining.structures(snap, findPathFor(snap));
    expect(claims).toContainEqual({ x: 1, y: 10, room: "W2N1", type: "container", sourceId: source.id });
  });

  // The W8N3 incident's actual mechanism: pickRemotes' reevaluate branch (mining/pickRemotes.ts) can
  // evict a previously-selected source outright — it simply isn't in the next setRemotes write, so
  // colony.remoteSources no longer contains it at all (a stronger condition than "still selected but
  // danger/reservedBy is set", which the tests above already cover and no longer drop the claim for).
  // structures() only ever iterates colony.remoteSources (see the `for (const source of
  // colony.remoteSources)` loop) — once a source is absent from that array, NOTHING claims its tiles
  // any more, home-room leg included. This is what starves an already-built road of its claim and lets
  // building.ts's stale/unwanted check (which only shields home-room tiles still in `claimed`) tear it
  // down as unwanted — see building.test.ts's "after a remote source is evicted" suite for the
  // demolition side of this.
  it("claims nothing at all for a source once it is absent from colony.remoteSources (evicted)", () => {
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      remoteSources: [], // evicted: the source that owned `route` is no longer selected
      remoteStructures: {}
    });

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
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

// The remote-route equivalent of recordSourceSpot's container bookkeeping — closes the loop so
// RemoteSourceMemory.containerId (already read by buildRemoteSources/Logistics) actually gets written.
describe("Mining.intents — remote container recording", () => {
  const anchor = { x: 10, y: 10 };
  const route = [
    { room: "W1N1", x: 11, y: 10 },
    { room: "W2N1", x: 1, y: 10 } // container spot
  ];

  it("records a remote container's id once one is visible at the route's spot", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const container = containerAt(1, 10);
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteStructures: { W2N1: [{ id: container.id, x: 1, y: 10, type: "container" }] }
    });

    expect(mining.intents(snap)).toContainEqual({
      kind: "recordRemoteContainer",
      room: "W1N1",
      remoteRoom: "W2N1",
      source: source.id,
      container: container.id
    });
  });

  it("emits nothing for a remote room without vision this tick", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteStructures: {}
    });

    expect(mining.intents(snap).filter(i => i.kind === "recordRemoteContainer")).toEqual([]);
  });

  it("emits nothing when no container structure sits on the route's spot yet", () => {
    const source = remoteSourceAt(2, 10, "W2N1", { route });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteStructures: { W2N1: [] }
    });

    expect(mining.intents(snap).filter(i => i.kind === "recordRemoteContainer")).toEqual([]);
  });

  it("emits nothing once the container id already matches what's recorded", () => {
    const container = containerAt(1, 10);
    const source = remoteSourceAt(2, 10, "W2N1", { route, containerId: container.id });
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteStructures: { W2N1: [{ id: container.id, x: 1, y: 10, type: "container" }] }
    });

    expect(mining.intents(snap).filter(i => i.kind === "recordRemoteContainer")).toEqual([]);
  });
});

// Persists a remote room's live danger read (see RemoteMemory.dangerUntil) so losing vision of an
// invaded remote doesn't silently reset it to "safe" — see snapshot.remoteDanger, the fresh-this-tick
// counterpart to the memory-blended SnapRemoteSource.danger.
describe("Mining.intents — remote danger recording", () => {
  it("emits the fresh dangerUntil for a remote room with vision this tick", () => {
    const source = remoteSourceAt(2, 10, "W2N1");
    const snap = colonySnap({
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteDanger: { W2N1: 5500 }
    });

    expect(mining.intents(snap)).toContainEqual({
      kind: "recordRemoteDanger",
      room: "W1N1",
      remoteRoom: "W2N1",
      dangerUntil: 5500,
      reservedBy: undefined
    });
  });

  it("emits an all-clear (undefined) when this tick's vision shows no hostiles", () => {
    const source = remoteSourceAt(2, 10, "W2N1");
    const snap = colonySnap({
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteDanger: { W2N1: undefined }
    });

    expect(mining.intents(snap)).toContainEqual({
      kind: "recordRemoteDanger",
      room: "W1N1",
      remoteRoom: "W2N1",
      dangerUntil: undefined,
      reservedBy: undefined
    });
  });

  it("emits this tick's fresh reservedBy read alongside dangerUntil", () => {
    const source = remoteSourceAt(2, 10, "W2N1");
    const snap = colonySnap({
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteDanger: { W2N1: undefined },
      remoteReservedBy: { W2N1: "Invader" }
    });

    expect(mining.intents(snap)).toContainEqual({
      kind: "recordRemoteDanger",
      room: "W1N1",
      remoteRoom: "W2N1",
      dangerUntil: undefined,
      reservedBy: "Invader"
    });
  });

  it("emits nothing for a remote room without vision this tick", () => {
    const source = remoteSourceAt(2, 10, "W2N1");
    const snap = colonySnap({
      sources: [],
      controllerLevel: 3,
      remoteSources: [source],
      remoteDanger: {}
    });

    expect(mining.intents(snap).filter(i => i.kind === "recordRemoteDanger")).toEqual([]);
  });

  it("emits only once per room even when several of its sources are selected", () => {
    const a = remoteSourceAt(2, 10, "W2N1");
    const b = remoteSourceAt(3, 10, "W2N1");
    const snap = colonySnap({
      sources: [],
      controllerLevel: 3,
      remoteSources: [a, b],
      remoteDanger: { W2N1: 5500 }
    });

    expect(mining.intents(snap).filter(i => i.kind === "recordRemoteDanger")).toHaveLength(1);
  });
});

// Step 8: autonomous remote selection. Mining emits a setRemotes intent on its throttle tick, driven by
// pickRemotes over the scouted neighbours — no hand-seed. Off-tick it's silent so the cached set is stable.
describe("Mining.intents — remote selection", () => {
  const setRemotesOf = (snap: Parameters<Mining["intents"]>[0], colonyRequestParts = 0) =>
    mining
      .intents(snap, colonyRequestParts)
      .filter((i: Intent): i is Extract<Intent, { kind: "setRemotes" }> => i.kind === "setRemotes");

  it("emits setRemotes on the throttle tick, selecting a scouted profitable neighbour", () => {
    const snap = colonySnap({
      tick: 1000, // a multiple of remoteSelectionEvery (1000)
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

  it("never selects a source another colony already claimed this tick", () => {
    // Same shape as the "selecting a scouted profitable neighbour" case above, but this Mining instance
    // is constructed with that exact source id in siblingRemoteSourceIds (as Colony's constructor would
    // pass it, derived from another colony's own remoteSources — see colony/index.ts) — self-collision
    // between two of our own colonies must never happen.
    const guardedMining = new Mining("W1N1", new Set(["rs" as Id<Source>]));
    const snap = colonySnap({
      tick: 1000,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    const intents = guardedMining
      .intents(snap, 0)
      .filter((i: Intent): i is Extract<Intent, { kind: "setRemotes" }> => i.kind === "setRemotes");
    expect(intents).toEqual([]);
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
      tick: 1000,
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
      tick: 1000,
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
    // creeps so even a small remote-miner body can't fit underneath — spawn load must read >= 85%.
    const saturating = snapCreeps("upgrader", 50, { body: Array(10).fill(WORK) });
    const snap = colonySnap({
      tick: 1000,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      creeps: saturating,
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    expect(setRemotesOf(snap)).toEqual([]);
  });

  it("stays silent when sibling operations' requests alone push colony-wide load past the ceiling", () => {
    // No living creeps and no miner requests of Mining's own — a colony-blind check would see 0 load
    // and wave a new remote through. colonyRequestParts is what the metrics panel's load figure is built
    // from (every operation's desiredCreeps summed), so this must gate on it too, not just Mining's slice.
    const snap = colonySnap({
      tick: 1000,
      anchor: { x: 25, y: 25 },
      controllerLevel: 3,
      energyCapacity: 800,
      spawns: [spawn()],
      scoutTargets: [scoutTarget("W2N1", scouted({ sources: [{ id: "rs" as Id<Source>, x: 25, y: 25 }] }))]
    });

    expect(setRemotesOf(snap, 500)).toEqual([]);
  });

  it("fires on the full-reevaluation tick and can evict a stale source even though it isn't new, once eviction hysteresis's grace period elapses", () => {
    // remoteReevaluateEvery (5000) is itself a multiple of remoteSelectionEvery (1000), so this tick
    // would fire regardless — the real thing under test is that it runs in reevaluate mode, which is
    // only observable via eviction: a previously-selected-but-now-worse source loses its slot to a
    // better one once the cap is full, which the plain append-only throttle could never do. Eviction
    // hysteresis (pickRemotes.ts's EVICTION_STRIKES_THRESHOLD) protects an incumbent for its first
    // couple of misses, so this drives 3 consecutive reevaluate ticks (5000, 10000, 15000), threading
    // each tick's returned remoteStrikes into the next snapshot exactly as the real memory round-trip
    // (ColonyMemory.remoteStrikes) would, to reach the tick where the eviction actually lands.
    const packed = scoutTarget(
      "W2N1",
      scouted({
        sources: Array.from({ length: 6 }, (_, i) => ({
          id: `worse${i}` as Id<Source>,
          x: 25,
          y: 25,
          paths: { W1N1: "1".repeat(80) }
        }))
      })
    );
    const better = scoutTarget(
      "W3N1",
      scouted({ sources: [{ id: "better" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }] })
    );
    const remoteSources = Array.from({ length: 6 }, (_, i) => ({
      id: `worse${i}` as Id<Source>,
      room: "W2N1",
      x: 25,
      y: 25,
      distance: 80,
      openTiles: 1,
      reserved: false,
      danger: 0
    }));

    let remoteStrikes: Partial<Record<Id<Source>, number>> = {};
    let intent: Extract<Intent, { kind: "setRemotes" }> | undefined;
    for (const tick of [5000, 10000, 15000]) {
      const snap = colonySnap({
        tick,
        anchor: { x: 25, y: 25 },
        controllerLevel: 3,
        energyCapacity: 800,
        spawns: [spawn()],
        remoteSources,
        remoteStrikes,
        scoutTargets: [packed, better]
      });
      [intent] = setRemotesOf(snap);
      if (intent) remoteStrikes = intent.strikes;
    }

    expect(intent).toBeDefined();
    const ids = intent!.remotes.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toContain("better");
  });
});
