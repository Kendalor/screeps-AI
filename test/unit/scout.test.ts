// The scout behaviour's pure core: whether a room's data has gone stale, and which rooms are still
// viable candidates to scout next. Ranking those candidates by real travel distance needs
// Game.map.findRoute (execute.ts's job, covered in execute.test.ts); this pure pool is unit-tested here.

import { describe, expect, it } from "vitest";
import { hasFortifiedInvaderCore, needsPassiveRecording, needsScouting, scoutCandidatePool, staleAfter } from "../../src/behaviors/scoutTargets";
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

  // A room that killed one of our creeps on arrival must not be re-offered while the backoff is fresh,
  // even though it's otherwise "never seen" (tick absent) and would normally always need scouting — a
  // scout dispatched there dies before recordScout's intent can run, so waiting for `tick` to update
  // would mean it's re-offered to every replacement scout, forever (see schema.ts's lethalAt doc).
  it("refuses a lethal room within the backoff window even when never physically recorded", () => {
    const target = scoutTarget("W1N2", { type: "normal", sources: [], hostile: true, lethalAt: 1000 });
    expect(needsScouting(target, 1000)).toBe(false);
  });

  it("resumes offering a lethal room once its backoff window has elapsed", () => {
    const target = scoutTarget("W1N2", { type: "normal", sources: [], hostile: true, lethalAt: 0 });
    expect(needsScouting(target, 20000)).toBe(true); // NO_PATH_RETRY_AFTER
  });

  it("still refuses a lethal room even if tick looks fresh (e.g. recorded the instant it died)", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 999, lethalAt: 1000 }));
    expect(needsScouting(target, 1000)).toBe(false);
  });

  // A Stronghold's fortified core is just as lethal to an unarmed scout as a towered room, and unlike
  // lethalAt it's known the instant the core is seen — no need to wait for a death (see schema.ts's
  // ScoutInfo.invaderCore doc).
  it("refuses a room with an already-deployed fortified core", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0, invaderCore: { level: 3 } }));
    expect(needsScouting(target, 100)).toBe(false);
  });

  it("refuses a room whose fortified core has finished deploying by now", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0, invaderCore: { level: 1, ticksToDeploy: 500 } }));
    expect(needsScouting(target, 500)).toBe(false);
  });

  // needsScouting still says "not due yet" here (the room isn't otherwise stale — see staleAfter), but
  // the point of this case is that it's not the FORTIFIED-CORE check refusing it; hasFortifiedInvaderCore
  // itself (tested directly below) is what actually distinguishes "not deployed yet" from "live."
  it("does not treat a not-yet-deployed core as fortified", () => {
    const info = scouted({ tick: 0, invaderCore: { level: 1, ticksToDeploy: 500 } });
    expect(hasFortifiedInvaderCore(info, 100)).toBe(false);
  });

  // A level-0 core is a plain remote-mining-room core (see remoteInvaderAttacks.ts's
  // NON_FORTIFIED_CORE_LEVEL) — no combat threat, so it must not gate scouting the way a Stronghold does.
  it("does not refuse a room with only a level-0 (non-fortified) core", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0, invaderCore: { level: 0 } }));
    expect(needsScouting(target, staleAfter("normal"))).toBe(true);
  });

  // Once a fortified core's projected collapse has passed, needsScouting must re-offer the room promptly
  // (the tightened Invader-related interval), not wait out a keeper room's full 200k-tick staleAfter —
  // otherwise a room that's actually safe again stays wrongly avoided for a huge stretch of the game.
  it("re-offers a room soon after its fortified core's projected collapse, on the tightened interval", () => {
    const target = scoutTarget(
      "W44N14", // keeper-band room name, so staleAfter("keeper") would be 200000 if not tightened
      scouted({ type: "keeper", tick: 0, invaderCore: { level: 3, collapseTicksRemaining: 1000 } })
    );
    // Collapses at tick 1000; the tightened interval (INVADER_OWNED_STALE_AFTER) counts from tick 0.
    expect(needsScouting(target, staleAfter("highway"))).toBe(true); // stale by the tightened interval
    expect(needsScouting(target, staleAfter("highway") - 1)).toBe(false); // one tick short of either gate
  });
});

describe("hasFortifiedInvaderCore", () => {
  it("is false when there's no recorded core", () => {
    expect(hasFortifiedInvaderCore(scouted(), 100)).toBe(false);
  });

  it("is false for a level-0 core", () => {
    expect(hasFortifiedInvaderCore(scouted({ invaderCore: { level: 0 } }), 100)).toBe(false);
  });

  it("is true for a fortified core with no ticksToDeploy (already deployed)", () => {
    expect(hasFortifiedInvaderCore(scouted({ invaderCore: { level: 2 } }), 100)).toBe(true);
  });

  it("projects ticksToDeploy forward from the observation tick", () => {
    const info = scouted({ tick: 1000, invaderCore: { level: 2, ticksToDeploy: 100 } });
    expect(hasFortifiedInvaderCore(info, 1050)).toBe(false); // not deployed yet
    expect(hasFortifiedInvaderCore(info, 1100)).toBe(true); // deployed by now
  });

  // Without projecting collapseTicksRemaining forward too, a deployed core would read as fortified
  // forever with no way back — even long after the real stronghold collapsed live.
  it("projects collapseTicksRemaining forward from the observation tick", () => {
    const info = scouted({ tick: 1000, invaderCore: { level: 2, collapseTicksRemaining: 500 } });
    expect(hasFortifiedInvaderCore(info, 1499)).toBe(true); // not collapsed yet
    expect(hasFortifiedInvaderCore(info, 1500)).toBe(false); // collapsed by now
  });

  it("stays fortified forever when deployed but the collapse timer was never observed", () => {
    // A core observed as deployed before this field existed, or an edge case where the collapse effect
    // wasn't present in the find results — no way to know when it's safe, so this errs toward "avoid".
    const info = scouted({ tick: 1000, invaderCore: { level: 2 } });
    expect(hasFortifiedInvaderCore(info, 999999)).toBe(true);
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
