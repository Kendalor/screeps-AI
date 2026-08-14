// autoPickColonyTarget: throttled empire-wide scan of Memory.rooms for the best colonize candidate,
// live-re-derived against current scouting data, handed off to a sponsor colony durably (the same
// addColonizeTarget path a manual flag uses — see colonize.ts's header) rather than spawning anything.

import { describe, expect, it } from "vitest";
import {
  autoPickColonyTarget,
  listColonizeCandidates,
  AUTO_PICK_INTERVAL,
  MIN_COLONY_DISTANCE,
  MAX_COLONY_DISTANCE,
  MIN_COLONY_SCORE,
  MIN_COLONY_SOURCES
} from "../../../src/empire/pickColonyTargets";
import { COLONIZER_COST } from "../../../src/behaviors/roles/colonizer";
import { NEW_MINERAL_BONUS } from "../../../src/mining/rankColonizeCandidate";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";
import type { ColonizationPotential, ScoutInfo } from "../../../src/memory/schema";

function scoutInfo(over: Partial<ScoutInfo> = {}): ScoutInfo {
  return { tick: 0, type: "normal", sources: sourcesOf(MIN_COLONY_SOURCES), hostile: false, ...over };
}

// Minimal ScoutedSource stand-ins — only `.length` is exercised by the source-count gate under test.
function sourcesOf(count: number): ScoutInfo["sources"] {
  return Array.from({ length: count }, (_, i) => ({ id: `source${i}` as Id<Source>, x: 10, y: 10 }));
}

// Default normal potential is comfortably above MIN_COLONY_SCORE so tests not specifically exercising the
// score gate aren't incidentally rejected by it.
function potential(over: Partial<ColonizationPotential> = {}): ColonizationPotential {
  return { normal: MIN_COLONY_SCORE + 20, keeper: 0, keeperMinerals: [], ...over };
}

// A candidate room fully viable on cached data: has an anchor, has a scored (non-empty) neighborhood.
function viableCandidate(over: Partial<ScoutInfo> = {}): ScoutInfo {
  return scoutInfo({
    anchor: { x: 25, y: 25 },
    anchorChecked: true,
    potential: potential(),
    potentialChecked: true,
    ...over
  });
}

// Default route length every findRoute stub below returns unless a test overrides it — comfortably inside
// [MIN_COLONY_DISTANCE, MAX_COLONY_DISTANCE] so the distance-band gate doesn't incidentally reject
// candidates in tests that aren't specifically exercising that gate.
const DEFAULT_ROUTE_HOPS = Math.round((MIN_COLONY_DISTANCE + MAX_COLONY_DISTANCE) / 2);

function routeOfLength(hops: number): { room: string }[] {
  return Array.from({ length: hops }, (_, i) => ({ room: `hop${i}` }));
}

// Sets up Game/Memory for a firing tick. `rooms` seeds Memory.rooms[x].scouted; `remotes` seeds
// Memory.colonies[home].remotes for the overlap-guard tests. The live re-check (scoutCandidatesAround)
// walks Game.map.describeExits — stubbed with no exits, so every candidate's own neighborhood is trivially
// "fully scouted" (zero neighbors to be missing) and its live score is just its own summarizePotential
// of nothing, i.e. 0 — tests that need a specific live score seed the candidate room's OWN entry, since
// summarizePotential always excludes distance-0 (the room being scored) from its own sum. To get a
// specific non-zero live score, seed a same-map neighbor via describeExits.
function setUp(rooms: Record<string, ScoutInfo>, gclLevel = 10, time = AUTO_PICK_INTERVAL) {
  stubGame({ time });
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.gcl = { level: gclLevel };
  game.map = {
    findRoute: (_from: string, _dest: string) => routeOfLength(DEFAULT_ROUTE_HOPS),
    describeExits: () => ({}), // no neighbors — every candidate's neighborhood is trivially "fully scouted"
    getRoomStatus: () => ({ status: "normal" })
  };
  (globalThis as { Memory: Record<string, unknown> }).Memory = {
    creeps: {},
    rooms: Object.fromEntries(Object.entries(rooms).map(([room, scouted]) => [room, { scouted }])),
    colonies: {}
  };
}

const colonizingOf = (room: string): string[] =>
  ((Memory as unknown as { colonies: Record<string, { colonizing?: string[] }> }).colonies[room]?.colonizing) ?? [];

const affordableSponsor = () => colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST });

describe("autoPickColonyTarget", () => {
  it("does nothing off the throttle tick", () => {
    setUp({ W5N5: viableCandidate() }, 10, AUTO_PICK_INTERVAL + 1);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("does nothing when the GCL room budget is already spent", () => {
    setUp({ W5N5: viableCandidate() }, /* gclLevel */ 1);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("hands off the only viable candidate to the sponsor", () => {
    setUp({ W5N5: viableCandidate() });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("ignores a room with no anchor", () => {
    setUp({ W5N5: viableCandidate({ anchor: undefined }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("ignores a room with fewer than MIN_COLONY_SOURCES sources", () => {
    setUp({ W5N5: viableCandidate({ sources: sourcesOf(MIN_COLONY_SOURCES - 1) }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("includes a room with exactly MIN_COLONY_SOURCES sources", () => {
    setUp({ W5N5: viableCandidate({ sources: sourcesOf(MIN_COLONY_SOURCES) }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("ignores a room whose potential hasn't been scored yet", () => {
    setUp({ W5N5: viableCandidate({ potentialChecked: false, potential: undefined }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("ignores an owned or hostile room", () => {
    setUp({ W5N5: viableCandidate({ owner: "someoneElse" }), W6N6: viableCandidate({ hostile: true }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("excludes an owned colony's own room even when ScoutInfo.owner was never set on it", () => {
    // Self-claims never populate ScoutInfo.owner (only other players' rooms do) — Memory.colonies
    // membership is the only reliable signal that a scouted room is actually one of ours.
    setUp({ W1N1: viableCandidate(), W5N5: viableCandidate() });
    (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies.W1N1 = { remotes: [] };
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("prefers the higher-scoring candidate", () => {
    setUp({
      W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) }),
      W6N6: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE + 50 }) })
    });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W6N6"]);
  });

  it("excludes a room already selected as a remote by any colony", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies.W1N1 = {
      remotes: [{ room: "W5N5", sources: [], reserved: false }]
    };
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("falls through to the next-best candidate when the top one has no fitting sponsor", () => {
    setUp({
      W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE + 50 }) }), // best score, but unreachable below
      W6N6: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) })
    });
    // Make W5N5 unreachable from every colony, W6N6 reachable at the default (in-band) distance.
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = (_from: string, dest: string) =>
      dest === "W5N5" ? ERR_NO_PATH : routeOfLength(DEFAULT_ROUTE_HOPS);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W6N6"]);
  });

  it("bonuses a candidate with a new mineral the empire doesn't already have", () => {
    setUp({
      // Equal base potential; W6N6 additionally has a mineral no owned colony has yet.
      W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) }),
      W6N6: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }), mineral: "X" as MineralConstant })
    });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(NEW_MINERAL_BONUS).toBeGreaterThan(0); // sanity: the bonus this test relies on is actually positive
    expect(colonizingOf("W1N1")).toEqual(["W6N6"]);
  });

  it("excludes a candidate closer than MIN_COLONY_DISTANCE to the nearest owned colony", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () =>
      routeOfLength(MIN_COLONY_DISTANCE - 1);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("includes a candidate exactly at MIN_COLONY_DISTANCE", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () => routeOfLength(MIN_COLONY_DISTANCE);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("excludes a candidate farther than MAX_COLONY_DISTANCE from every owned colony", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () =>
      routeOfLength(MAX_COLONY_DISTANCE + 1);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("includes a candidate exactly at MAX_COLONY_DISTANCE", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () => routeOfLength(MAX_COLONY_DISTANCE);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("excludes a candidate scoring below MIN_COLONY_SCORE", () => {
    setUp({ W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE - 1 }) }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual([]);
  });

  it("includes a candidate scoring exactly MIN_COLONY_SCORE", () => {
    setUp({ W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) }) });
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W5N5"]);
  });

  it("picks the candidate with the higher score even when it's farther away, as long as both are in-band", () => {
    setUp({
      W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) }),
      W6N6: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE + 50 }) })
    });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = (_from: string, dest: string) =>
      dest === "W5N5" ? routeOfLength(MIN_COLONY_DISTANCE) : routeOfLength(MAX_COLONY_DISTANCE);
    const world = testEmpire(affordableSponsor());

    autoPickColonyTarget(world);

    expect(colonizingOf("W1N1")).toEqual(["W6N6"]);
  });
});

describe("listColonizeCandidates", () => {
  it("returns every cached candidate sorted by score descending", () => {
    setUp({
      W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE }) }),
      W6N6: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE + 50 }) })
    });
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing.map(c => c.room)).toEqual(["W6N6", "W5N5"]);
    expect(listing[0].score).toBeGreaterThan(listing[1].score);
    expect(listing.every(c => c.reason === undefined)).toBe(true);
  });

  it("flags a candidate too close to an owned colony, without excluding it", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () =>
      routeOfLength(MIN_COLONY_DISTANCE - 1);
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ room: "W5N5", reason: "tooClose", distance: MIN_COLONY_DISTANCE - 1 });
  });

  it("flags a candidate too far from every owned colony", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () =>
      routeOfLength(MAX_COLONY_DISTANCE + 1);
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing[0].reason).toBe("tooFar");
  });

  it("flags an unreachable candidate", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = () => ERR_NO_PATH;
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing[0]).toMatchObject({ room: "W5N5", reason: "unreachable", distance: Infinity });
  });

  it("flags a candidate scoring below MIN_COLONY_SCORE, without excluding it", () => {
    setUp({ W5N5: viableCandidate({ potential: potential({ normal: MIN_COLONY_SCORE - 1 }) }) });
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ room: "W5N5", reason: "scoreTooLow" });
  });

  it("flags a candidate already claimed as a remote by an owned colony", () => {
    setUp({ W5N5: viableCandidate() });
    (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies.W1N1 = {
      remotes: [{ room: "W5N5", sources: [], reserved: false }]
    };
    const world = testEmpire(affordableSponsor());

    const listing = listColonizeCandidates(world);

    expect(listing[0].reason).toBe("remoteMiningOverlap");
  });

  it("excludes rooms with no anchor or unscored potential", () => {
    setUp({
      W5N5: viableCandidate({ anchor: undefined }),
      W6N6: viableCandidate({ potentialChecked: false, potential: undefined })
    });
    const world = testEmpire(affordableSponsor());

    expect(listColonizeCandidates(world)).toEqual([]);
  });

  it("excludes a room with fewer than MIN_COLONY_SOURCES sources", () => {
    setUp({ W5N5: viableCandidate({ sources: sourcesOf(MIN_COLONY_SOURCES - 1) }) });
    const world = testEmpire(affordableSponsor());

    expect(listColonizeCandidates(world)).toEqual([]);
  });

  it("returns an empty list when nothing has been scouted", () => {
    setUp({});
    const world = testEmpire(affordableSponsor());

    expect(listColonizeCandidates(world)).toEqual([]);
  });
});
