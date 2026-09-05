import { afterEach, describe, it, expect } from "vitest";
import { pickRemotes as pickRemotesRaw } from "../../../src/mining/pickRemotes";
import { scoutTarget, scouted } from "../../fixtures";

// A home state that comfortably affords miners/claimers and has plenty of spawns (room cap =
// MAX_REMOTE_ROOMS_PER_SPAWN * spawnCount), so only the economics/net-worth ranking and the room cap
// itself are under test unless a case overrides it.
function homeState(over: Partial<Parameters<typeof pickRemotesRaw>[0]["home"]> = {}) {
  return {
    name: "W1N1",
    storage: { x: 25, y: 25 },
    energyCapacity: 800,
    spawnCount: 5,
    ...over
  };
}

// Defaults to today's append-only mode (reevaluate: false), no sibling-colony exclusions, and no prior
// eviction strikes, so existing tests don't all need to spell any of them out; tests exercising the
// periodic full re-rank pass `reevaluate: true` explicitly, the sibling-collision tests pass
// `excludedSourceIds` explicitly, and the hysteresis tests pass `strikes` explicitly. Returns just the
// selected RemoteMemory[] (not the full { remotes, strikes } result) — this file's existing assertions
// all read the selection directly; the hysteresis-specific describe block below calls pickRemotesRaw
// directly instead, since it needs the returned strikes too.
function pickRemotes(
  input: Omit<Parameters<typeof pickRemotesRaw>[0], "reevaluate" | "excludedSourceIds" | "strikes"> &
    Partial<Pick<Parameters<typeof pickRemotesRaw>[0], "reevaluate" | "excludedSourceIds" | "strikes">>
) {
  return pickRemotesRaw({ reevaluate: false, excludedSourceIds: new Set(), strikes: {}, ...input }).remotes;
}

describe("pickRemotes", () => {
  it("selects an adjacent scouted room's source", () => {
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

  it("selects nothing when there are no spawns at all (room cap is zero)", () => {
    const candidates = [scoutTarget("W2N1", scouted())];
    expect(
      pickRemotes({ candidates, home: homeState({ spawnCount: 0 }), currentlySelected: [] })
    ).toEqual([]);
  });

  it("selects every source in a newly-selected room together, not one at a time", () => {
    // One adjacent room packed with many profitable sources, none yet selected: all of them are added,
    // since entering the room (scouting, eventual reservation) is a one-time cost paid regardless of how
    // many of its sources get mined, and a selected room is never partially staffed.
    const packed = scoutTarget(
      "W2N1",
      scouted({ sources: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}` as Id<Source>, x: 25, y: 25 })) })
    );
    const selected = pickRemotes({ candidates: [packed], home: homeState(), currentlySelected: [] });
    expect(selected).toHaveLength(1);
    expect(selected[0].sources).toHaveLength(4);
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

  it("append-only commits only one new room per call, even with two worthwhile candidates", () => {
    const roomA = scoutTarget("W2N1", scouted({ sources: [{ id: "a" as Id<Source>, x: 25, y: 25 } ] }));
    const roomB = scoutTarget("W3N1", scouted({ sources: [{ id: "b" as Id<Source>, x: 25, y: 25 } ] }));
    const rooms = pickRemotes({ candidates: [roomA, roomB], home: homeState(), currentlySelected: [] }).map(
      r => r.room
    );
    expect(rooms).toHaveLength(1);
  });

  it("ranks the richer room first: a farther room with more/better sources beats a nearer single-source room", () => {
    // Both rooms are well within MAX_REMOTE_HOPS, so hop distance doesn't disqualify either — the
    // append-only pass must pick whichever has the higher aggregate net worth, not whichever is nearer.
    const richer = scoutTarget(
      "W3N1",
      scouted({
        sources: [
          { id: "rich0" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(10) } },
          { id: "rich1" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(10) } }
        ]
      })
    );
    const thinner = scoutTarget(
      "W2N1",
      scouted({ sources: [{ id: "thin0" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }] })
    );
    const rooms = pickRemotes({ candidates: [thinner, richer], home: homeState(), currentlySelected: [] }).map(
      r => r.room
    );
    expect(rooms).toEqual(["W3N1"]);
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
    // Equal source counts and comparable distances so this isolates hop-count trust from net-worth
    // ranking: only one of the two rooms should even be a candidate slot winner here since both are
    // otherwise identical single-source rooms — distance still nudges net worth, but the point under
    // test is that scoutGraph's real hop count (not room-name math) is what's consulted at all.
    const rooms = pickRemotes({
      candidates: [diagonal, trueNeighbour],
      home: homeState(),
      currentlySelected: []
    }).map(r => r.room);
    expect(rooms).toEqual(["W2N1"]); // the true (1-hop) neighbour has the shorter cached-path distance, wins
  });

  it("excludes a candidate farther than MAX_REMOTE_HOPS even when otherwise profitable", () => {
    const tooFar = scoutTarget("W5N1", scouted({ sources: [{ id: "far_room" as Id<Source>, x: 25, y: 25 }] }));
    const rooms = pickRemotes({ candidates: [tooFar], home: homeState(), currentlySelected: [] });
    expect(rooms).toEqual([]);
  });

  it("excludes a room owned/reserved by another player, even if otherwise the richest", () => {
    const hostileRoom = scoutTarget(
      "W2N1",
      scouted({ owner: "Enemy", hostile: true, sources: [{ id: "enemy_src" as Id<Source>, x: 25, y: 25 }] })
    );
    const rooms = pickRemotes({ candidates: [hostileRoom], home: homeState(), currentlySelected: [] });
    expect(rooms).toEqual([]);
  });

  it("still allows a room reserved by the Invader NPC (not marked hostile) to be selected", () => {
    // observeRoom (execute.ts) never sets `hostile` for an Invader-core reservation — that's treated as
    // temporary/contestable, not a real-player claim (see remoteInvaderAttacks.ts). Selection stays open;
    // Mining/Reservation's own reservedBy gate is what actually withholds staffing from it.
    const invaderRoom = scoutTarget(
      "W2N1",
      scouted({ owner: "Invader", hostile: false, sources: [{ id: "invader_src" as Id<Source>, x: 25, y: 25 } ] })
    );
    const rooms = pickRemotes({ candidates: [invaderRoom], home: homeState(), currentlySelected: [] });
    const ids = rooms.flatMap(r => r.sources.map(s => s.id));
    expect(ids).toContain("invader_src");
  });

  it("excludes the whole room when even one of its sources is claimed by another colony this tick", () => {
    const candidates = [
      scoutTarget(
        "W2N1",
        scouted({
          sources: [
            { id: "shared_src" as Id<Source>, x: 25, y: 25 },
            { id: "free_src" as Id<Source>, x: 26, y: 25 }
          ]
        })
      )
    ];
    const rooms = pickRemotes({
      candidates,
      home: homeState(),
      currentlySelected: [],
      excludedSourceIds: new Set(["shared_src" as Id<Source>])
    });
    // A partial room (mining just "free_src") would contradict the all-or-nothing selection rule, so the
    // whole room is excluded even though free_src on its own would otherwise be worthwhile.
    expect(rooms).toEqual([]);
  });

  it("prices by a candidate's cached real path distance instead of the tile-inset estimate", () => {
    // Two single-source rooms at the same room-graph hop distance, so remoteDistanceEstimate would tie
    // them (both sources sit at the same in-room position). A real cached path makes W3N1 cheaper (higher
    // net worth) despite that tie.
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
    expect(rooms).toEqual(["W3N1"]); // real_path's cheaper cached distance wins the higher net worth
  });

  it("never drops an already-selected room even past the cap on append-only", () => {
    const rooms3 = ["W2N1", "W3N1", "W4N1"].map((room, i) =>
      scoutTarget(room, scouted({ sources: [{ id: `s${i}` as Id<Source>, x: 25, y: 25 }] }))
    );
    // Cap is MAX_REMOTE_ROOMS_PER_SPAWN (1 spawn); all 3 rooms are already selected (e.g. from before
    // the cap tightened, or spawnCount having since dropped).
    const rooms = pickRemotes({
      candidates: rooms3,
      home: homeState({ spawnCount: 1 }),
      currentlySelected: ["s0", "s1", "s2"] as Id<Source>[]
    }).map(r => r.room);
    expect(rooms.sort()).toEqual(["W2N1", "W3N1", "W4N1"]);
  });

  it("caps the number of selected rooms at MAX_REMOTE_ROOMS_PER_SPAWN * spawnCount", () => {
    const rooms3 = [2, 3, 4].map(n =>
      scoutTarget(`W${n}N1`, scouted({ sources: [{ id: `s${n}` as Id<Source>, x: 25, y: 25 }] }))
    );
    // 1 spawn => cap of 2 rooms; append-only only ever adds one new room per call regardless, so drive
    // two calls to actually fill the cap.
    const first = pickRemotes({ candidates: rooms3, home: homeState({ spawnCount: 1 }), currentlySelected: [] });
    const firstIds = first.flatMap(r => r.sources.map(s => s.id));
    const second = pickRemotes({
      candidates: rooms3,
      home: homeState({ spawnCount: 1 }),
      currentlySelected: firstIds
    });
    expect(second).toHaveLength(2); // capped at 2 rooms even though a 3rd worthwhile room exists
  });

  describe("reevaluate", () => {
    it("re-ranks by net worth and can evict the weakest previously-selected room for a richer one — once eviction hysteresis's grace period elapses", () => {
      // Two incumbent rooms fill a 2-room cap (1 spawn); a much richer newly-scouted 3rd room shows up.
      // Without reevaluate both incumbents are kept unconditionally (append-only); with reevaluate the
      // richer room must eventually displace the weaker incumbent, but only once hysteresis's grace
      // period elapses.
      const incumbentWeak = scoutTarget(
        "W2N1",
        scouted({ sources: [{ id: "weak" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(150) } }] })
      );
      const incumbentStrong = scoutTarget(
        "W3N1",
        scouted({ sources: [{ id: "strong" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(10) } }] })
      );
      const richer = scoutTarget(
        "W4N1",
        scouted({
          sources: [
            { id: "better0" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } },
            { id: "better1" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1" } }
          ]
        })
      );
      const home = homeState({ spawnCount: 1 });
      const incumbentIds = ["weak", "strong"] as Id<Source>[];

      const appendOnly = pickRemotes({
        candidates: [incumbentWeak, incumbentStrong, richer],
        home,
        currentlySelected: incumbentIds
      }).map(r => r.room);
      expect(appendOnly.sort()).toEqual(["W2N1", "W3N1"]); // append-only never evicts

      let strikes: Record<string, number> = {};
      let reevaluated: ReturnType<typeof pickRemotesRaw>["remotes"] = [];
      for (let pass = 0; pass < 3; pass++) {
        const result = pickRemotesRaw({
          candidates: [incumbentWeak, incumbentStrong, richer],
          home,
          currentlySelected: incumbentIds,
          reevaluate: true,
          excludedSourceIds: new Set(),
          strikes
        });
        reevaluated = result.remotes;
        strikes = result.strikes;
      }
      const rooms = reevaluated.map(r => r.room);
      expect(rooms).toContain("W4N1");
      expect(rooms).toContain("W3N1"); // the stronger incumbent survives
      expect(rooms).not.toContain("W2N1"); // the weakest incumbent is the one evicted
    });

    it("an evicted room is only reselected if it still wins the pool on its own merits, not automatically restored", () => {
      const stillWorse = scoutTarget(
        "W2N1",
        scouted({ sources: [{ id: "worse" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(80) } }] })
      );
      const { remotes } = pickRemotesRaw({
        candidates: [stillWorse],
        home: homeState({ spawnCount: 1 }),
        currentlySelected: [], // already evicted; caller no longer passes it as selected
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: {}
      });
      // Nothing else competes for the slot, so it comes back on its own merits — not because anything
      // "remembered" it was evicted.
      expect(remotes.map(r => r.room)).toEqual(["W2N1"]);
    });
  });

  // Eviction hysteresis: a previously-selected room that misses the reevaluate cut is protected for
  // EVICTION_STRIKES_THRESHOLD - 1 consecutive misses before it's actually dropped — an already-built
  // claim (roads, containers) is a sunk cost that shouldn't unwind on a single noisy pass. See
  // pickRemotes.ts's EVICTION_STRIKES_THRESHOLD and its reevaluate branch. These call pickRemotesRaw
  // directly (not the local `pickRemotes` wrapper) since they need the returned strikes back.
  describe("eviction hysteresis", () => {
    // Cap is MAX_REMOTE_ROOMS_PER_SPAWN * 1 spawn. Two incumbents ("safe", cheap, and "squeezed",
    // expensive) already fill it; "better" is a newly-scouted room cheap enough to outrank "squeezed" but
    // never both incumbents at once — a genuine, ongoing squeeze on "squeezed" across every pass, not a
    // one-off fluke that resolves itself.
    const safeRoom = "W2N1";
    const safeId = "safe" as Id<Source>;
    const squeezedRoom = "W3N1";
    const squeezedId = "squeezed" as Id<Source>;
    const betterRoom = "W4N1";
    const betterId = "better" as Id<Source>;
    const incumbentIds = [safeId, squeezedId];
    function scenario() {
      const safe = scoutTarget(safeRoom, scouted({ sources: [{ id: safeId, x: 25, y: 25, paths: { W1N1: "1" } }] }));
      const squeezed = scoutTarget(
        squeezedRoom,
        scouted({ sources: [{ id: squeezedId, x: 25, y: 25, paths: { W1N1: "1".repeat(150) } }] })
      );
      const better = scoutTarget(
        betterRoom,
        scouted({ sources: [{ id: betterId, x: 25, y: 25, paths: { W1N1: "1".repeat(100) } }] })
      );
      return { candidates: [safe, squeezed, better], home: homeState({ spawnCount: 1 }) };
    }

    it("protects a squeezed incumbent room on the first miss instead of dropping it immediately", () => {
      const { candidates, home } = scenario();
      const result = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: {}
      });
      expect(result.remotes.map(r => r.room)).toContain(squeezedRoom); // protected — one bad pass isn't enough
      expect(result.strikes[squeezedRoom]).toBe(1); // strike recorded for next pass to consult
    });

    it("increments strikes on each consecutive miss while still within the grace period", () => {
      const { candidates, home } = scenario();
      const pass1 = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: {}
      });
      const pass2 = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: pass1.strikes
      });
      expect(pass1.strikes[squeezedRoom]).toBe(1);
      expect(pass2.strikes[squeezedRoom]).toBe(2);
      expect(pass2.remotes.map(r => r.room)).toContain(squeezedRoom);
    });

    it("actually evicts once strikes reach EVICTION_STRIKES_THRESHOLD, never before", () => {
      const { candidates, home } = scenario();
      let strikes: Record<string, number> = {};
      let rooms: string[] = [];
      // EVICTION_STRIKES_THRESHOLD is 3: passes 1-2 must still protect; pass 3 must evict.
      for (let pass = 1; pass <= 3; pass++) {
        const result = pickRemotesRaw({
          candidates,
          home,
          currentlySelected: incumbentIds,
          reevaluate: true,
          excludedSourceIds: new Set(),
          strikes
        });
        rooms = result.remotes.map(r => r.room);
        strikes = result.strikes;
        if (pass < 3) expect(rooms).toContain(squeezedRoom);
      }
      expect(rooms).not.toContain(squeezedRoom);
      expect(rooms).toContain(betterRoom);
      expect(rooms).toContain(safeRoom); // never in danger — it always makes the cut on its own merits
    });

    it("resets strikes to 0 once a protected room cleanly makes the cut again on its own merits", () => {
      const { candidates, home } = scenario();
      const pass1 = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: {}
      });
      expect(pass1.strikes[squeezedRoom]).toBe(1);

      // Cap opens up wide enough for every room on the next pass (more spawns) — "squeezed" now makes
      // the cut cleanly, not merely on borrowed time, so its strike count should clear rather than carry.
      const pass2 = pickRemotesRaw({
        candidates,
        home: homeState({ spawnCount: 5 }),
        currentlySelected: incumbentIds,
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: pass1.strikes
      });
      expect(pass2.remotes.map(r => r.room)).toContain(squeezedRoom);
      expect(pass2.strikes[squeezedRoom] ?? 0).toBe(0);
    });

    it("never grows the selection past the room cap even while protecting incumbents", () => {
      // 2 incumbent rooms already fill a 2-room cap; a much richer 3rd room is also worthwhile.
      // Protecting both squeezed incumbents on the same pass "better" is admitted must not push the total
      // to 3 — the cap always wins; "better" (a brand-new admission, no sunk cost yet) is the one bumped.
      const incumbent0 = scoutTarget(
        "W2N1",
        scouted({ sources: [{ id: "incumbent0" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(150) } }] })
      );
      const incumbent1 = scoutTarget(
        "W3N1",
        scouted({ sources: [{ id: "incumbent1" as Id<Source>, x: 25, y: 25, paths: { W1N1: "1".repeat(150) } }] })
      );
      const better = scoutTarget(
        "W4N1",
        scouted({ sources: [{ id: betterId, x: 25, y: 25, paths: { W1N1: "1" } }] })
      );

      const result = pickRemotesRaw({
        candidates: [incumbent0, incumbent1, better],
        home: homeState({ spawnCount: 1 }), // cap of 2
        currentlySelected: ["incumbent0" as Id<Source>, "incumbent1" as Id<Source>],
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: {}
      });
      const rooms = result.remotes.map(r => r.room);
      expect(rooms.length).toBeLessThanOrEqual(2);
      expect(rooms).not.toContain("W4N1");
      expect(rooms).toContain("W2N1");
      expect(rooms).toContain("W3N1");
    });

    it("append-only pass never evicts and carries strikes forward unchanged", () => {
      const { candidates, home } = scenario();
      const priorStrikes: Record<string, number> = { [squeezedRoom]: 2 };
      const result = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: [squeezedId],
        reevaluate: false,
        excludedSourceIds: new Set(),
        strikes: priorStrikes
      });
      // Append-only preserves every already-selected room unconditionally (today's existing behavior),
      // and since it made no eviction decision at all, its strike count is neither reset nor incremented.
      expect(result.remotes.map(r => r.room)).toContain(squeezedRoom);
      expect(result.strikes[squeezedRoom]).toBe(2);
    });

    it("prunes a strike entry once its room is no longer selected at all", () => {
      // A room with a stale strike entry that ISN'T in currentlySelected any more (fully evicted, or
      // just never re-selected) must not linger in the returned strikes map forever.
      const { candidates, home } = scenario();
      const staleStrikes: Record<string, number> = { [squeezedRoom]: 2, gone: 1 };
      const result = pickRemotesRaw({
        candidates,
        home,
        currentlySelected: [squeezedId], // "gone" is NOT selected any more
        reevaluate: true,
        excludedSourceIds: new Set(),
        strikes: staleStrikes
      });
      expect(result.strikes).not.toHaveProperty("gone");
    });
  });

  // Memory.debugDisableRemoteMining — an empire-wide kill switch (see its doc in memory/schema.ts) so a
  // scenario can isolate a colony's spawn economics from a competing remote-mining fleet.
  describe("Memory.debugDisableRemoteMining", () => {
    afterEach(() => {
      (globalThis as { Memory?: unknown }).Memory = undefined;
    });

    it("selects nothing at all while the flag is set, even with an otherwise-perfect candidate", () => {
      (globalThis as { Memory?: { debugDisableRemoteMining?: boolean } }).Memory = { debugDisableRemoteMining: true };
      const candidates = [scoutTarget("W2N1", scouted({ sources: [{ id: "s" as Id<Source>, x: 25, y: 25 }] }))];
      expect(pickRemotes({ candidates, home: homeState(), currentlySelected: [] })).toEqual([]);
    });

    it("selects normally when the flag is absent", () => {
      (globalThis as { Memory?: { debugDisableRemoteMining?: boolean } }).Memory = {};
      const candidates = [scoutTarget("W2N1", scouted({ sources: [{ id: "s" as Id<Source>, x: 25, y: 25 }] }))];
      expect(pickRemotes({ candidates, home: homeState(), currentlySelected: [] })).toHaveLength(1);
    });
  });
});
