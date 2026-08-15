// Scenario coverage for the W8N3 incident: a remote room's roads/containers were already built, then
// vanished. This suite walks the full pipeline — pickRemotes' selection/eviction decision, through
// Mining.structures' claim derivation, to building.ts's placeAndDemolish — across every scenario that
// can change a remote source's selection state: hostiles/danger, reserved vs unreserved, reserved by a
// different player, and spawn-capacity/load pressure. The goal is to pin down exactly which of these
// scenarios can make an already-built structure lose its claim (and, for the home-room leg, get
// actively demolished), versus which ones (as of the 25ab1b6 fix) now correctly leave the claim alone.

import { beforeEach, describe, expect, it } from "vitest";
import { colony } from "../../src/colony";
import { Mining } from "../../src/operations/mining";
import { pickRemotes } from "../../src/mining/pickRemotes";
import { colonySnap, remoteSourceAt, scoutTarget, scouted } from "../fixtures";
import type { ColonySnapshot, SnapRemoteSource } from "../../src/snapshot/types";
import { findPath, resetFindPathCacheForTests, type FindPath } from "../../src/construction/planner";
import { stubPathFinderSingleRoom } from "../constants";

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
  // claimsOf seeds a matrix for every room a resolved claim lands in (see construction/planner.ts's
  // claimsOf loop) — including a remote room Mining's route claims tag, even though nothing ever
  // pathfinds there — so building() on a remote-source snapshot needs Game.map.getRoomTerrain stubbed.
  (globalThis as unknown as { Game: { map: { getRoomTerrain: (room: string) => { get(x: number, y: number): number } } } }).Game = {
    map: { getRoomTerrain: () => ({ get: () => 0 }) } // fully open room, every tile walkable
  };
});

const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

const mining = new Mining("W1N1");
// Same anchor building.test.ts's remote-construction suite uses, confirmed clear of the bunker's own
// (RCL8) goal footprint — a route tile that coincidentally lands on a wanted goal tile would be
// "blocking" rather than genuinely stale, muddying what these tests are meant to isolate.
const anchor = { x: 25, y: 25 };

// A realistic already-built remote route: home-room leg, a road tile in the remote room, and the
// container spot. The home-room leg tile (35,35) is deliberately far outside the bunker's own (RCL8)
// goal footprint — same coordinate building.test.ts's "flags a stale non-spawn structure" test uses —
// so it can only ever be genuinely stale/unwanted or genuinely claimed, never "blocking" a coincidental
// goal-layout placement (e.g. a controller-adjacent container claim), which would muddy what these
// demolition-focused tests are meant to isolate.
const route = [
  { room: "W1N1", x: 35, y: 35 },
  { room: "W2N1", x: 2, y: 25 },
  { room: "W2N1", x: 1, y: 25 }
];
const homeLegRoad = { x: 35, y: 35, type: "road" as const };

function builtSnap(source: SnapRemoteSource, homeStructures: { x: number; y: number; type: BuildableStructureConstant }[] = []) {
  return colonySnap({
    anchor,
    sources: [],
    controllerLevel: 3,
    energyCapacity: 800,
    structures: [homeLegRoad, ...homeStructures],
    remoteSources: [source],
    remoteStructures: { W2N1: [{ x: 1, y: 25, type: "container" }] }
  });
}

describe("remote structure claims across scenario changes — still selected", () => {
  // These mirror/extend the existing per-field regression tests in building.test.ts and
  // mining.test.ts, gathered here as one scenario sweep for clarity: as long as a source remains in
  // colony.remoteSources, none of these individually-changing fields should drop its claim.
  const scenarios: [string, Partial<SnapRemoteSource>][] = [
    ["unreserved, no hostiles (baseline)", {}],
    ["reserved by us", { reserved: true }],
    ["reserved by the Invader NPC", { reservedBy: "Invader" }],
    ["reserved by a different real player", { reservedBy: "SomePlayer" }],
    ["hostiles present (danger)", { danger: 1 }],
    ["hostiles present AND reserved by another player", { danger: 3, reservedBy: "SomePlayer" }]
  ];

  it.each(scenarios)("keeps the full route claimed when %s", (_label, over) => {
    const source = remoteSourceAt(2, 25, "W2N1", { route, ...over });
    const snap = builtSnap(source);

    const claims = mining.structures(snap, findPathFor(snap));
    expect(claims).toContainEqual({ x: 35, y: 35, room: "W1N1", type: "road", sourceId: source.id });
    expect(claims.some(c => c.room === "W2N1")).toBe(true);
  });

  it.each(scenarios)("never demolishes the home-room leg via building() when %s", (_label, over) => {
    const source = remoteSourceAt(2, 25, "W2N1", { route, ...over });
    const snap = colony(builtSnap(source));

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals.some(r => r.x === 35 && r.y === 35)).toBe(false);
  });
});

describe("remote structure claims once a source is evicted (absent from colony.remoteSources)", () => {
  // Whatever scenario caused the eviction (spawn load, a better-ranked competitor, becoming
  // unprofitable), the downstream effect on already-built structures is identical: the source is gone
  // from colony.remoteSources, so Mining stops claiming its tiles outright. This is the shared sink
  // every eviction scenario below funnels into.
  it("Mining.structures claims nothing for the route once its source is absent", () => {
    const snap = colonySnap({
      anchor,
      sources: [],
      controllerLevel: 3,
      energyCapacity: 800,
      structures: [homeLegRoad],
      remoteSources: [], // evicted
      remoteStructures: {}
    });

    expect(mining.structures(snap, findPathFor(snap))).toEqual([]);
  });

  it("building() demolishes the orphaned home-room-leg road as unwanted — the actual W8N3 bug", () => {
    const snap = colony(
      colonySnap({
        anchor,
        sources: [],
        controllerLevel: 3,
        energyCapacity: 800,
        structures: [homeLegRoad], // built while the source was still selected
        remoteSources: [], // evicted since
        remoteStructures: {}
      })
    );

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals).toContainEqual({ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "road" });
  });

  it("building() never touches the remote room's own already-built structures directly (they're merely orphaned, not razed)", () => {
    // Confirms the asymmetry: the home-room leg gets ACTIVELY demolished (it's inside colony.structures,
    // which placeAndDemolish's stale/unwanted check inspects), but the remote room's own container/road
    // — living in colony.remoteStructures, never colony.structures — is never inspected by that check at
    // all. In-game this reads as "the remote structures just sit there unmaintained," not "torn down,"
    // unless something else (decay, a rival, invaders) destroys them physically.
    const snap = colony(
      colonySnap({
        anchor,
        sources: [],
        controllerLevel: 3,
        energyCapacity: 800,
        structures: [homeLegRoad],
        remoteSources: [],
        remoteStructures: {} // no live vision asserted here — remote demolition isn't a concept in this arbiter regardless
      })
    );

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals.every(r => r.room === "W1N1")).toBe(true);
  });
});

describe("scenario: pickRemotes eviction under spawn-capacity pressure, wired end to end", () => {
  // Home has ALREADY committed to a full slate of distant, marginal sources (MAX_REMOTE_SOURCES = 6,
  // mirrors a real colony that grew into this state gradually — see pickRemotes.test.ts's own "full
  // re-evaluation can evict..." test, whose setup this mirrors). A closer, cheaper room is scouted
  // later. On the throttled reevaluate tick, every candidate — incumbents and new — competes on equal
  // footing (see pickRemotes.ts's reevaluate branch), so the worst incumbent loses its slot purely to a
  // better competitor, with no hostiles/danger/reservation involved at all.
  const incumbentIds = Array.from({ length: 6 }, (_, i) => `incumbent${i}` as Id<Source>);
  const betterId = "better" as Id<Source>;

  it("reevaluate evicts the worst-ranked incumbent in favor of a much closer one, once the cap is full and eviction hysteresis's grace period elapses", () => {
    const packedIncumbents = scoutTarget(
      "W2N1",
      scouted({
        sources: incumbentIds.map(id => ({ id, x: 25, y: 25, paths: { W1N1: "1".repeat(80) } }))
      })
    );
    const better = scoutTarget("W3N1", scouted({ sources: [{ id: betterId, x: 25, y: 25, paths: { W1N1: "1" } }] }));

    // Eviction hysteresis (pickRemotes.ts's EVICTION_STRIKES_THRESHOLD) protects an incumbent for its
    // first couple of misses, so this drives 3 consecutive reevaluate passes — threading each pass's
    // returned strikes into the next, exactly as mining.ts's remoteSelection does via
    // ColonyMemory.remoteStrikes — to reach the pass where the eviction actually lands.
    let strikes: Record<Id<Source>, number> = {};
    let selectedIds: Id<Source>[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const result = pickRemotes({
        candidates: [packedIncumbents, better],
        home: {
          name: "W1N1",
          storage: anchor,
          energyCapacity: 800,
          spawnLoad: 0.5,
          spawnCapacity: 500,
          localLoadParts: 0
        },
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes
      });
      selectedIds = result.remotes.flatMap(r => r.sources.map(s => s.id));
      strikes = result.strikes;
    }

    expect(selectedIds).toContain(betterId);
    // The cap (6) is unchanged, but "better" displaced exactly one incumbent to fit.
    expect(selectedIds).toHaveLength(6);
    expect(incumbentIds.filter(id => !selectedIds.includes(id))).toHaveLength(1);
  });

  it("the evicted incumbent's already-built home-leg road is then torn down as unwanted the same tick colony.remoteSources drops it", () => {
    // Picks up exactly where the eviction above leaves off: colony.remoteSources no longer contains
    // `incumbent` (setRemotes wrote only `better`), but its road is still physically standing. `better`
    // routes through a different, far home-room tile (36,36), so it can't coincidentally re-claim
    // incumbent's (35,35) itself.
    const snap = colony(
      colonySnap({
        anchor,
        sources: [],
        controllerLevel: 3,
        energyCapacity: 800,
        structures: [homeLegRoad], // incumbent's home-leg, built pre-eviction
        remoteSources: [remoteSourceAt(2, 25, "W3N1", { route: [{ room: "W1N1", x: 36, y: 36 }, { room: "W3N1", x: 1, y: 25 }] })],
        remoteStructures: { W3N1: [] }
      })
    );

    const removals = snap.building().filter(i => i.kind === "removeStructure");
    expect(removals).toContainEqual({ kind: "removeStructure", room: "W1N1", x: 35, y: 35, type: "road" });
  });
});

describe("scenario: spawn-load recovering below the ceiling does not resurrect an evicted source on its own", () => {
  // pickRemotes never re-adds a previously-evicted source automatically — reevaluate re-ranks the
  // CURRENT candidate pool, and once a source has been dropped from currentlySelected (by the caller,
  // per setRemotes overwriting Memory.colonies[room].remotes), it competes as a brand-new candidate
  // again, same as any other. This documents that eviction is a one-way trip absent operator/logic
  // intervention — there is no "spawn load dropped, so bring back what I lost" path today.
  it("an evicted source is only reselected if it still wins the pool on its own merits, not automatically restored", () => {
    const stillWorse = scoutTarget(
      "W2N1",
      scouted({ sources: [{ id: "worse" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(80) } }] })
    );
    const { remotes } = pickRemotes({
      candidates: [stillWorse],
      home: {
        name: "W1N1",
        storage: anchor,
        energyCapacity: 800,
        spawnLoad: 0.1, // load has since dropped well below the ceiling
        spawnCapacity: 500,
        localLoadParts: 0
      },
      currentlySelected: [], // already evicted; caller no longer passes it as selected
      reevaluate: true,
      excludedSourceIds: new Set(),
      strikes: {}
    });

    // It's still worthwhile on its own (nothing else competes for the slot), so it DOES come back here —
    // but only because pickRemotes independently re-derives it's worthwhile, not because anything
    // "remembered" it was evicted. A source that had been dropped for being genuinely unprofitable would
    // not return even after load recovered.
    const selectedIds = remotes.flatMap(r => r.sources.map(s => s.id));
    expect(selectedIds).toContain("worse");
  });
});
