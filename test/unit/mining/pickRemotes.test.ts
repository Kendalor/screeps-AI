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
    const remotes = pickRemotes({ candidates, home: homeState() });
    expect(remotes).toHaveLength(1);
    expect(remotes[0].room).toBe("W2N1");
    expect(remotes[0].sources.map(s => s.id)).toEqual(["s_near"]);
  });

  it("selects nothing when energyCapacity can't afford a useful miner", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(pickRemotes({ candidates, home: homeState({ energyCapacity: 300 }) })).toEqual([]);
  });

  it("selects nothing when the spawn has no headroom for more creeps", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(pickRemotes({ candidates, home: homeState({ spawnHeadroom: false }) })).toEqual([]);
  });

  it("never mines the home room even if it appears as a candidate", () => {
    const candidates = [scoutTarget("W1N1", scouted()), scoutTarget("W2N1", scouted())];
    const rooms = pickRemotes({ candidates, home: homeState() }).map(r => r.room);
    expect(rooms).not.toContain("W1N1");
  });

  it("skips unscouted candidates (no source data to decide on)", () => {
    const candidates = [scoutTarget("W2N1") /* no info */];
    expect(pickRemotes({ candidates, home: homeState() })).toEqual([]);
  });

  it("ranks nearer rooms before farther ones", () => {
    const near = scoutTarget("W2N1", scouted({ sources: [{ id: "near" as Id<Source>, x: 25, y: 25 }] }));
    const far = scoutTarget("W3N1", scouted({ sources: [{ id: "far" as Id<Source>, x: 25, y: 25 }] }));
    // Pass far first to prove ordering is by distance, not input order.
    const rooms = pickRemotes({ candidates: [far, near], home: homeState() }).map(r => r.room);
    expect(rooms).toEqual(["W2N1", "W3N1"]);
  });
});
