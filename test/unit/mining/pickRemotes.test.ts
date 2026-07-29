import { describe, it, expect } from "vitest";
import { pickRemotes } from "../../../src/mining/pickRemotes";
import { scoutTarget, scouted } from "../../fixtures";

// A home state that comfortably affords miners/claimers and has spawn headroom, so gates 2 and 3 pass
// and only the economics/nearest-first ranking is under test unless a case overrides it.
function homeState(over: Partial<Parameters<typeof pickRemotes>[0]["home"]> = {}) {
  return { name: "W1N1", storage: { x: 25, y: 25 }, energyCapacity: 800, spawnHeadroom: true, ...over };
}

describe("pickRemotes", () => {
  it("selects an adjacent scouted room's near source", () => {
    // A scouted neighbour with two sources near the room centre — both profitable at ~1 room out.
    const candidates = [
      scoutTarget("W2N1", scouted({ sources: [{ id: "s_near" as Id<Source>, x: 25, y: 25 }] }))
    ];
    const remotes = pickRemotes({ candidates, home: homeState(), currentlySelected: [] });
    expect(remotes).toHaveLength(1);
    expect(remotes[0].room).toBe("W2N1");
    expect(remotes[0].sources.map(s => s.id)).toEqual(["s_near"]);
  });

  it("selects nothing when energyCapacity can't afford a useful miner", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(
      pickRemotes({ candidates, home: homeState({ energyCapacity: 300 }), currentlySelected: [] })
    ).toEqual([]);
  });

  it("selects nothing when the spawn has no headroom for more creeps", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(
      pickRemotes({ candidates, home: homeState({ spawnHeadroom: false }), currentlySelected: [] })
    ).toEqual([]);
  });

  it("never mines the home room even if it appears as a candidate", () => {
    const candidates = [scoutTarget("W1N1", scouted()), scoutTarget("W2N1", scouted())];
    const rooms = pickRemotes({ candidates, home: homeState(), currentlySelected: [] }).map(r => r.room);
    expect(rooms).not.toContain("W1N1");
  });

  it("skips unscouted candidates (no source data to decide on)", () => {
    const candidates = [scoutTarget("W2N1") /* no info */];
    expect(pickRemotes({ candidates, home: homeState(), currentlySelected: [] })).toEqual([]);
  });

  it("ranks nearer rooms before farther ones, but only adds one new source per call", () => {
    const near = scoutTarget("W2N1", scouted({ sources: [{ id: "near" as Id<Source>, x: 25, y: 25 }] }));
    const far = scoutTarget("W3N1", scouted({ sources: [{ id: "far" as Id<Source>, x: 25, y: 25 }] }));
    // Pass far first to prove ordering is by distance, not input order.
    const rooms = pickRemotes({ candidates: [far, near], home: homeState(), currentlySelected: [] }).map(
      r => r.room
    );
    expect(rooms).toEqual(["W2N1"]); // nearest wins the single slot this call; "far" waits its turn
  });

  it("adds only one never-before-selected source per call, even when several are newly profitable", () => {
    // One adjacent room packed with many profitable sources, none yet selected: only one is added.
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: [] });
    const total = selected.reduce((n, r) => n + r.sources.length, 0);
    expect(total).toBe(1); // MAX_NEW_REMOTES_PER_SELECTION — one trickled in even though 12 were profitable
  });

  it("keeps previously-selected sources and trickles in one more, up to the overall cap", () => {
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const alreadyHave = ["s0", "s1", "s2", "s3", "s4"] as Id<Source>[];
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: alreadyHave });
    const ids = selected.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toHaveLength(6); // MAX_REMOTE_SOURCES — the 5 kept plus exactly one new one
    for (const id of alreadyHave) expect(ids).toContain(id);
  });

  it("never drops an already-selected source even past the cap on re-rank", () => {
    // 6 already selected (at the cap); a nearer never-selected candidate shows up too. The existing 6
    // must all survive — the cap bounds new additions, not previously committed sources.
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const alreadyHave = ["s1", "s2", "s3", "s4", "s5", "s6"] as Id<Source>[];
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: alreadyHave });
    const ids = selected.flatMap(r => r.sources.map(s => s.id));
    for (const id of alreadyHave) expect(ids).toContain(id);
    expect(ids).toHaveLength(6); // at the overall cap already: no room for "s0" this call
  });
});
