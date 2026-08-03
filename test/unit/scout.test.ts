// The scout behaviour's pure core: whether a room's data has gone stale, and which rooms are still
// viable candidates to scout next. Ranking those candidates by real travel distance needs
// Game.map.findRoute (execute.ts's job, covered in execute.test.ts); this pure pool is unit-tested here.

import { describe, expect, it } from "vitest";
import { needsPassiveRecording, needsScouting, scoutCandidatePool, staleAfter } from "../../src/behaviors/scout";
import { scouted, scoutTarget } from "../fixtures";

describe("needsScouting", () => {
  // A core's reservation can outlive the core itself, so a room already known to be Invader-held must
  // get re-checked far sooner than a normal room's 100k-tick interval — otherwise remoteInvaderAttacks.ts
  // never gets the live vision it needs to confirm the core is still standing and prune it.
  it("re-checks an Invader-owned room much sooner than an ordinary normal room", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0, owner: "Invader" }));
    const ordinary = scoutTarget("W1N3", scouted({ tick: 0 }));
    const now = staleAfter("highway"); // the Invader-owned interval
    expect(needsScouting(target, now)).toBe(true);
    expect(needsScouting(ordinary, now)).toBe(false);
  });

  it("falls back to the normal interval once the Invader owner is gone", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0 }));
    expect(needsScouting(target, staleAfter("highway"))).toBe(false);
  });
});

describe("needsPassiveRecording", () => {
  it("wants a room never observed", () => {
    expect(needsPassiveRecording(undefined, 100)).toBe(true);
  });

  it("skips a room seen within the passive interval", () => {
    expect(needsPassiveRecording(scouted({ tick: 0 }), 1499)).toBe(false);
  });

  it("wants a room whose observation has gone stale, well before active staleAfter would trigger", () => {
    expect(needsPassiveRecording(scouted({ tick: 0 }), 1500)).toBe(true);
  });
});

describe("scoutCandidatePool", () => {
  it("returns nothing when every room is fresh", () => {
    const todo = [scoutTarget("W1N2", scouted()), scoutTarget("W2N1", scouted())];
    expect(scoutCandidatePool(todo, 100)).toEqual([]);
  });

  it("includes every room still needing scouting", () => {
    const todo = [scoutTarget("W1N4"), scoutTarget("W1N2")];
    expect(scoutCandidatePool(todo, 0)).toEqual(["W1N4", "W1N2"]);
  });

  it("excludes rooms that are still fresh", () => {
    const todo = [scoutTarget("W1N2", scouted({ tick: 100 })), scoutTarget("W2N1")];
    // now=150 keeps W1N2 fresh (interval is huge for normal rooms), so only the unseen W2N1 remains.
    expect(scoutCandidatePool(todo, 150)).toEqual(["W2N1"]);
  });

  it("excludes the room the scout just came from when another stale room exists", () => {
    // Without this, two rooms mutually nearest each other would ping-pong a scout forever.
    const todo = [scoutTarget("W1N1"), scoutTarget("W1N3")];
    expect(scoutCandidatePool(todo, 0, "W1N1")).toEqual(["W1N3"]);
  });

  it("falls back to the avoided room when it's the only stale candidate left", () => {
    const todo = [scoutTarget("W1N1")];
    expect(scoutCandidatePool(todo, 0, "W1N1")).toEqual(["W1N1"]);
  });
});
