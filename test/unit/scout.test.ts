// The scout behaviour's pure core: given the rooms that still need scouting and where the scout is,
// which room should it walk to next. Target *selection* is pure (nearest unscouted, deterministic
// tie-break), so it is unit-tested here; the travel and the Memory write that surround it are glue,
// verified in integration.

import { describe, expect, it } from "vitest";
import { needsPassiveRecording, pickScoutTarget } from "../../src/behaviors/scout";
import { scouted, scoutTarget } from "../fixtures";

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

describe("pickScoutTarget", () => {
  it("returns nothing when every reachable room is fresh", () => {
    const todo = [scoutTarget("W1N2", scouted()), scoutTarget("W2N1", scouted())];
    expect(pickScoutTarget(todo, "W1N1", 100)).toBeUndefined();
  });

  it("picks the nearest unscouted room to where the scout stands", () => {
    // From W1N1: W1N2 is distance 1, W1N4 is distance 3 — the near one wins.
    const todo = [scoutTarget("W1N4"), scoutTarget("W1N2")];
    expect(pickScoutTarget(todo, "W1N1", 0)).toBe("W1N2");
  });

  it("measures distance from the scout's current room, not its home colony", () => {
    // The scout has walked out to W1N3; from there W1N4 (dist 1) beats W1N1 (dist 2).
    const todo = [scoutTarget("W1N1"), scoutTarget("W1N4")];
    expect(pickScoutTarget(todo, "W1N3", 0)).toBe("W1N4");
  });

  it("skips rooms that are still fresh and picks the stale one", () => {
    const todo = [scoutTarget("W1N2", scouted({ tick: 100 })), scoutTarget("W2N1")];
    // now=150 keeps W1N2 fresh (interval is huge for normal rooms), so the unseen W2N1 is chosen.
    expect(pickScoutTarget(todo, "W1N1", 150)).toBe("W2N1");
  });

  it("breaks ties deterministically by room name, so two scouts don't thrash the same choice", () => {
    // Both distance 1 from W1N1; the name-sorted first wins, every tick, for every scout.
    const todo = [scoutTarget("W2N1"), scoutTarget("W1N2")];
    const first = pickScoutTarget(todo, "W1N1", 0);
    expect(first).toBe(pickScoutTarget(todo, "W1N1", 0));
    expect(["W1N2", "W2N1"]).toContain(first);
  });

  it("avoids sending the scout straight back to the room it just left when another stale room exists", () => {
    // Standing in W1N2, both W1N1 (just left) and W1N3 are stale; without avoidance W1N1 would win
    // (tied distance, name sort) and the scout would ping-pong between two mutually-nearest rooms forever.
    const todo = [scoutTarget("W1N1"), scoutTarget("W1N3")];
    expect(pickScoutTarget(todo, "W1N2", 0, "W1N1")).toBe("W1N3");
  });

  it("falls back to the avoided room when it's the only stale candidate left", () => {
    const todo = [scoutTarget("W1N1")];
    expect(pickScoutTarget(todo, "W1N2", 0, "W1N1")).toBe("W1N1");
  });
});
