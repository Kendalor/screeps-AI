import { describe, it, expect } from "vitest";
import { pickRemotes as pickRemotesRaw } from "../../../src/mining/pickRemotes";
import { scoutTarget, scouted } from "../../fixtures";

// A home state that comfortably affords miners/claimers and has ample spawn headroom (5 spawns' worth
// of capacity, 0 load), so gates 2 and 3 pass and only the economics/nearest-first ranking is under test
// unless a case overrides it.
function homeState(over: Partial<Parameters<typeof pickRemotesRaw>[0]["home"]> = {}) {
  return {
    name: "W1N1",
    storage: { x: 25, y: 25 },
    energyCapacity: 800,
    spawnLoad: 0,
    spawnCapacity: 5 * 500,
    localLoadParts: 0,
    ...over
  };
}

// Defaults to today's append-only mode (reevaluate: false) so existing tests don't all need to spell it
// out; tests exercising the periodic full re-rank pass `reevaluate: true` explicitly.
function pickRemotes(input: Omit<Parameters<typeof pickRemotesRaw>[0], "reevaluate"> & { reevaluate?: boolean }) {
  return pickRemotesRaw({ reevaluate: false, ...input });
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

  it("selects nothing when the spawn is already at or past the load ceiling", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(
      pickRemotes({ candidates, home: homeState({ spawnLoad: 0.85 }), currentlySelected: [] })
    ).toEqual([]);
  });

  it("selects nothing when there's no spawn capacity at all", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(
      pickRemotes({ candidates, home: homeState({ spawnCapacity: 0 }), currentlySelected: [] })
    ).toEqual([]);
  });

  it("skips a candidate whose added load would push spawn load past the ceiling", () => {
    const candidates = [
      scoutTarget("W2N1", scouted({ sources: [{ id: "s_near" as Id<Source>, x: 25, y: 25 }] }))
    ];
    // A tiny spawnCapacity (one bare miner body already costs more than the remaining budget) means even
    // a single profitable, near source can't be afforded without breaching MAX_SPAWN_LOAD.
    const remotes = pickRemotes({
      candidates,
      home: homeState({ spawnLoad: 0.8, spawnCapacity: 10 }),
      currentlySelected: []
    });
    expect(remotes).toEqual([]);
  });

  it("append-only leaves an already-over-budget colony's selection untouched (freeze, not prune)", () => {
    // Real scenario: a colony already carrying more remotes than its spawn can sustain (spawnLoad well
    // past MAX_SPAWN_LOAD from committed sources' live creeps/requests). The frequent append-only pass
    // must not touch the existing selection at all — no growth (already covered above) AND no shrink;
    // pruning back under the ceiling is reevaluate's job only (see the next test).
    const candidates = [scoutTarget("W2N1", scouted({ sources: [{ id: "new" as Id<Source>, x: 25, y: 25 }] }))];
    const alreadyHave = ["kept1", "kept2"] as Id<Source>[];
    // currentlySelected sources aren't in `candidates` here (no scouted info for their room), matching
    // how a real re-poll only re-derives from scoutTargets — append-only's `kept` filter preserves them
    // by id regardless, so this still exercises the freeze path faithfully.
    const remotes = pickRemotes({
      candidates,
      home: homeState({ spawnLoad: 1.5 }),
      currentlySelected: alreadyHave
    });
    expect(remotes).toEqual([]); // gate 3 bails before even reaching `kept`/`fresh` — nothing changes
  });

  it("reevaluate prunes an over-budget colony's selection back toward the ceiling, farthest first", () => {
    // 3 already-selected sources, priced so all 3 together exceed a deliberately small total budget but
    // the 2 nearest fit within it — reevaluate must charge every survivor (not just new ones) against the
    // budget and drop the farthest until back under it, since this is the only mechanism that can ever
    // shed an over-budget colony's load.
    const packed = scoutTarget(
      "W2N1",
      scouted({
        sources: [
          { id: "near" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }, // distance 1, cheap
          { id: "mid" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(5) } }, // distance 5
          { id: "far" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(200) } } // distance 200, priciest
        ]
      })
    );
    const alreadyHave = ["near", "mid", "far"] as Id<Source>[];

    const reevaluated = pickRemotesRaw({
      candidates: [packed],
      // spawnCapacity small enough that all 3 sources' combined load parts overshoot MAX_SPAWN_LOAD *
      // spawnCapacity, but near+mid together still fit. localLoadParts stays at homeState()'s default
      // (0) here — the budget is charged purely against spawnCapacity, isolating the nearest-first
      // eviction behavior from the local-load-netting case covered separately below.
      home: homeState({ spawnLoad: 0, spawnCapacity: 40 }),
      currentlySelected: alreadyHave,
      reevaluate: true
    });
    const ids = reevaluated.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toContain("near");
    expect(ids).not.toContain("far"); // the farthest/priciest is the one shed to fit the budget
  });

  it("reevaluate nets local load out of the budget, evicting even a source that fits its own estimate", () => {
    // near+mid together cost well under MAX_SPAWN_LOAD * spawnCapacity on their own load-parts estimate
    // alone (same fixture as the test above), but a big localLoadParts (local roles' real cost — the
    // thing this test exists to cover) eats most of the ceiling first. Reevaluate must net that out
    // before pricing candidates, or it would keep sources whose own estimate "fits" a budget that never
    // accounted for what local roles already consume — the actual bug this fixes: a colony whose local
    // load alone was already near the ceiling kept "fitting" a full remote fleet under cheap per-source
    // pricing, even though real total load had already passed 100%.
    const packed = scoutTarget(
      "W2N1",
      scouted({
        sources: [
          { id: "near" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } },
          { id: "mid" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(5) } }
        ]
      })
    );
    const alreadyHave = ["near", "mid"] as Id<Source>[];

    const reevaluated = pickRemotesRaw({
      candidates: [packed],
      // near costs 23 load parts, mid also 23 (both round up to the same small hauler headcount at
      // these distances) — near+mid together (46) comfortably exceed a ceiling of 0.85*100=85 on their
      // own, so this only isolates the local-load-netting behavior when localLoadParts (50) eats most of
      // it first: budget = 85 - 50 = 35, enough for near (23) alone but not near+mid (46).
      home: homeState({ spawnLoad: 0, spawnCapacity: 100, localLoadParts: 50 }),
      currentlySelected: alreadyHave,
      reevaluate: true
    });
    const ids = reevaluated.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toContain("near");
    expect(ids).not.toContain("mid");
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

  it("ranks nearer rooms before farther ones, but only commits one new room per call", () => {
    const near = scoutTarget("W2N1", scouted({ sources: [{ id: "near" as Id<Source>, x: 25, y: 25 }] }));
    const far = scoutTarget("W3N1", scouted({ sources: [{ id: "far" as Id<Source>, x: 25, y: 25 }] }));
    // Pass far first to prove ordering is by distance, not input order.
    const rooms = pickRemotes({ candidates: [far, near], home: homeState(), currentlySelected: [] }).map(
      r => r.room
    );
    expect(rooms).toEqual(["W2N1"]); // nearest wins the single room slot this call; "far" waits its turn
  });

  it("trusts the candidate's own room-graph distance instead of re-deriving it from room names", () => {
    // A room only connects N/S/E/W, so a diagonal neighbour is a real 2 hops away even though its name
    // alone (e.g. via Game.map.getRoomLinearDistance) would suggest 1. pickRemotes must rank by whatever
    // scoutGraph.ts's BFS actually measured (ScoutCandidate.distance), not recompute from the room names.
    const trueNeighbour = {
      room: "W2N1",
      distance: 1,
      type: "normal" as const,
      info: scouted({ sources: [{ id: "straight" as Id<Source>, x: 25, y: 25 }] })
    };
    const diagonal = {
      room: "W2N2",
      distance: 2, // real BFS hop count for a room only reachable via two crossings
      type: "normal" as const,
      info: scouted({ sources: [{ id: "diagonal" as Id<Source>, x: 25, y: 25 }] })
    };
    const rooms = pickRemotes({
      candidates: [diagonal, trueNeighbour],
      home: homeState(),
      currentlySelected: []
    }).map(r => r.room);
    expect(rooms).toEqual(["W2N1"]); // the true (1-hop) neighbour wins the single slot, not the diagonal one
  });

  it("commits every worthwhile source in a newly-selected room together, not one at a time", () => {
    // One adjacent room packed with many profitable sources, none yet selected: all of them are added,
    // since entering the room (scouting, eventual reservation) is a one-time cost paid regardless of how
    // many of its sources get mined — capped only by the overall source ceiling below.
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: [] });
    const total = selected.reduce((n, r) => n + r.sources.length, 0);
    expect(total).toBe(4);
  });

  it("caps a newly-committed room's sources at the overall ceiling, not the room's full source count", () => {
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: [] });
    const total = selected.reduce((n, r) => n + r.sources.length, 0);
    expect(total).toBe(6); // MAX_REMOTE_SOURCES — the room has 12 worthwhile sources but the cap is 6
  });

  it("keeps previously-selected sources and adds the next new room's sources, up to the overall cap", () => {
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const alreadyHave = ["s0", "s1", "s2", "s3", "s4"] as Id<Source>[];
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: alreadyHave });
    const ids = selected.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toHaveLength(6); // MAX_REMOTE_SOURCES — the 5 kept plus one more from the same room
    for (const id of alreadyHave) expect(ids).toContain(id);
  });

  it("adds a same-room sibling of an already-selected source even though a farther room got in first", () => {
    // Reproduces a real selection artifact: room W2N1 has two sources, only the farther one (within the
    // room) got selected on an earlier call, and a farther ROOM (W3N1) is already committed too. Once
    // W2N1 is already a selected room, its nearer sibling source should join it — it must not need to wait
    // behind W3N1 as if it were an unrelated, never-before-seen room competing for the single new-room slot.
    const w2n1 = scoutTarget(
      "W2N1",
      scouted({
        sources: [
          { id: "w2n1_far" as Id<Source>, x: 25, y: 40 }, // farther from centre, already selected
          { id: "w2n1_near" as Id<Source>, x: 25, y: 30 } // nearer, not yet selected
        ]
      })
    );
    const w3n1 = scoutTarget("W3N1", scouted({ sources: [{ id: "w3n1_src" as Id<Source>, x: 25, y: 25 }] }));
    const alreadyHave = ["w2n1_far", "w3n1_src"] as Id<Source>[];
    const selected = pickRemotes({
      candidates: [w2n1, w3n1],
      home: homeState(),
      currentlySelected: alreadyHave
    });
    const ids = selected.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toContain("w2n1_near");
  });

  it("excludes a candidate farther than MAX_REMOTE_HOPS even when otherwise near/profitable", () => {
    // A source placed at the room's dead centre so its tile-inset distance is tiny — profitable and
    // "near" by raw tile math — but the room itself is beyond the hop cap, which must win regardless.
    const tooFar = scoutTarget("W5N1", scouted({ sources: [{ id: "far_room" as Id<Source>, x: 25, y: 25 }] }));
    const rooms = pickRemotes({ candidates: [tooFar], home: homeState(), currentlySelected: [] });
    expect(rooms).toEqual([]);
  });

  it("prices and ranks by a candidate's cached real path distance instead of the tile-inset estimate", () => {
    // Two rooms at the same room-graph hop distance, so remoteDistanceEstimate would rank them purely by
    // tile inset (both sources sit at the same in-room position, so the estimate would tie them and fall
    // back to input order). A real cached path makes W3N1's source the true nearest despite that tie.
    const withEstimateOnly = scoutTarget(
      "W2N1",
      scouted({ sources: [{ id: "estimate_only" as Id<Source>, x: 25, y: 25 }] })
    );
    const withRealPath = scoutTarget(
      "W3N1",
      scouted({
        sources: [{ id: "real_path" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }] // real length 1, tiny
      })
    );
    const rooms = pickRemotes({
      candidates: [withEstimateOnly, withRealPath],
      home: homeState(),
      currentlySelected: []
    }).map(r => r.room);
    expect(rooms).toEqual(["W3N1"]); // real_path's cached distance (1) beats the estimate, wins the slot
  });

  it("full re-evaluation can evict a previously-selected source in favor of a newly-better one", () => {
    // 6 previously-selected sources already fill the cap, all with a costly cached real distance — a
    // farther room only just discovered, but with a much cheaper cached distance, must be able to bump
    // the single worst of them out on a full re-rank. Without reevaluate, all 6 are kept unconditionally
    // (append-only) and "better" would have to wait for its own new-room slot instead of ever displacing
    // one of them.
    const packed = scoutTarget(
      "W2N1",
      scouted({
        sources: Array.from({ length: 6 }, (_, i) => ({
          id: `worse${i}` as Id<Source>,
          x: 25,
          y: 25,
          paths: { W1N1: "1".repeat(80) } // costly real distance, still profitable but the weakest link
        }))
      })
    );
    const better = scoutTarget(
      "W3N1",
      scouted({ sources: [{ id: "better" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }] }) // real distance 1
    );
    const alreadyHave = Array.from({ length: 6 }, (_, i) => `worse${i}`) as Id<Source>[];

    // Without reevaluate: all 6 "worse" sources are kept unconditionally; "better" can't get in at all
    // since the cap is already full and only kept sources are preserved in append-only mode.
    const appendOnly = pickRemotes({ candidates: [packed, better], home: homeState(), currentlySelected: alreadyHave });
    const appendOnlyIds = appendOnly.flatMap(r => r.sources.map(s => s.id));
    expect(appendOnlyIds).toHaveLength(6);
    expect(appendOnlyIds).not.toContain("better");

    // With reevaluate: everything competes on equal footing; "better"'s real distance of 1 beats every
    // "worse" source's real distance of 80, so it displaces the worst of them.
    const reevaluated = pickRemotesRaw({
      candidates: [packed, better],
      home: homeState(),
      currentlySelected: alreadyHave,
      reevaluate: true
    });
    const ids = reevaluated.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toHaveLength(6);
    expect(ids).toContain("better");
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
