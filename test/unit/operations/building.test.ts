// The Building operation: the dedicated builder workforce that services outstanding construction.
// Quota scales by WORK parts, not headcount: 1 WORK per 1k of outstanding progress, translated into
// creeps via the current builder body's WORK count, capped at maxBuilders regardless of body size.

import { describe, expect, it } from "vitest";
import { Building } from "../../../src/operations/building";
import { colonySnap, remoteSourceAt, snapCreep, snapCreeps, sourceAt } from "../../fixtures";

describe("builder workforce", () => {
  const building = new Building("W1N1");

  it("asks for nothing without construction backlog", () => {
    const snap = colonySnap({ constructionProgress: 0, storageEnergy: 200_000 });
    expect(building.desiredCreeps(snap)).toEqual([]);
  });

  // At the 300-capacity default body (1 WORK/creep), 1 WORK per 1k of progress means one creep per 1k.
  it("scales one builder per 1k of work (1 WORK part each at the 300-capacity body)", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toHaveLength(3);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000 }))).toHaveLength(5);
  });

  // Hard ceiling regardless of how much WORK the backlog calls for (storage present, so income doesn't bind).
  it("caps at maxBuilders even when outstanding work asks for more", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 50_000, storageEnergy: 200_000 }))).toHaveLength(6);
    // With storage there's a buffer to burn on a blitz, so a 6-source room reaches the maxBuilders cap.
    const sources = [10, 12, 14, 16, 18, 20].map(y => sourceAt(20, y, `source_${y}`));
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 50_000, storageEnergy: 200_000, sources }))).toHaveLength(6);
  });

  // build() costs 5 e/tick per WORK, so pre-storage (no buffer to draw down) the WORK is capped at
  // income/5 = sources*10/5 = sources*2 WORK, no matter how large the backlog. Default fixture = 1 source.
  it("caps builder WORK at what income can feed when there is no storage", () => {
    // 1 source = 10 e/t → floor(10/5) = 2 sustainable WORK → 2 builders at the 1-WORK/creep 300 body,
    // even though 8k of backlog would otherwise ask for 8.
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 8_000, storageEnergy: 0 }))).toHaveLength(2);
    // 2 sources = 20 e/t → floor(20/5) = 4 sustainable WORK → 4 builders.
    const twoSources = [sourceAt(20, 10, "source_a"), sourceAt(20, 14, "source_b")];
    expect(
      building.desiredCreeps(colonySnap({ constructionProgress: 8_000, storageEnergy: 0, sources: twoSources }))
    ).toHaveLength(4);
  });

  // A staffed remote source adds to the pre-storage income cap too, at half its actual yield (the other
  // half is spoken for by the extra haul/upkeep a remote source costs that a local one doesn't).
  it("adds half of a staffed remote source's yield to the income-capped WORK budget", () => {
    // 1 local source = 10 e/t -> floor(10/5) = 2 sustainable WORK with no remote miner.
    const base = colonySnap({ constructionProgress: 8_000, storageEnergy: 0 });
    expect(building.desiredCreeps(base)).toHaveLength(2);

    // A remote miner with 6 WORK on an unreserved source yields min(6*2, grossHarvest(false)=5) = 5 e/t.
    // Half of that (2.5) added to local's 10 e/t -> floor(12.5/5) = 2 sustainable WORK still (rounds down).
    const oneRemoteMiner = snapCreep("miner", {
      body: [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE],
      memory: { sourceId: "remote_src_W2N1_25_25" as Id<Source> }
    });
    const withRemote = colonySnap({
      constructionProgress: 8_000,
      storageEnergy: 0,
      remoteSources: [remoteSourceAt(25, 25, "W2N1")],
      creeps: [oneRemoteMiner]
    });
    // 10 (local) + 0.5*5 (remote) = 12.5 e/t -> floor(12.5/5) = 2 WORK -> still 2 builders.
    expect(building.desiredCreeps(withRemote)).toHaveLength(2);

    // Two reserved remote sources, each fully staffed, yield grossHarvest(true)=10 e/t apiece = 20 e/t.
    // 10 (local) + 0.5*20 (remote) = 20 e/t -> floor(20/5) = 4 WORK -> 4 builders.
    const twoReservedMiners = [
      snapCreep("miner", {
        body: [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE],
        memory: { sourceId: "remote_src_W2N1_25_25" as Id<Source> }
      }),
      snapCreep("miner", {
        body: [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE],
        memory: { sourceId: "remote_src_W3N1_25_25" as Id<Source> }
      })
    ];
    const withTwoReserved = colonySnap({
      constructionProgress: 8_000,
      storageEnergy: 0,
      remoteSources: [
        remoteSourceAt(25, 25, "W2N1", { reserved: true }),
        remoteSourceAt(25, 25, "W3N1", { reserved: true })
      ],
      creeps: twoReservedMiners
    });
    expect(building.desiredCreeps(withTwoReserved)).toHaveLength(4);
  });

  // A bigger body (more WORK per creep) needs fewer creeps to cover the same WORK target.
  it("needs fewer creeps once the body carries more WORK per creep", () => {
    // 1100-capacity builder body carries multiple WORK parts, so 5k of progress (5 WORK) fits in fewer creeps.
    const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000, energyCapacity: 1100 });
    expect(building.desiredCreeps(snap).length).toBeLessThan(5);
  });

  it("returns nothing once the live builders meet the quota", () => {
    const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000, creeps: snapCreeps("builder", 5) });

    expect(building.desiredCreeps(snap)).toEqual([]);
  });

  it("scales builder demand off remote-room progress too, even with no home backlog", () => {
    // constructionProgress (home) is 0; only remoteConstructionProgress carries the backlog.
    expect(
      building.desiredCreeps(colonySnap({ constructionProgress: 0, remoteConstructionProgress: 3_000, storageEnergy: 200_000 }))
    ).toHaveLength(3);
  });

  it("sums home and remote progress toward the same quota", () => {
    expect(
      building.desiredCreeps(colonySnap({ constructionProgress: 2_000, remoteConstructionProgress: 3_000, storageEnergy: 200_000 }))
    ).toHaveLength(5);
  });

  describe("roleTargets (metrics denominator)", () => {
    it("reports the true builder target, matching the quota", () => {
      const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000 });
      expect(building.roleTargets(snap)).toEqual([{ role: "builder", target: 5 }]);
    });

    it("reports a target of 0 while builders are still alive — census reads this as a surplus", () => {
      // Nothing left to build but two builders remain: desiredCreeps hides this (returns []), roleTargets exposes it.
      const snap = colonySnap({ constructionProgress: 0, storageEnergy: 200_000, creeps: snapCreeps("builder", 2) });
      expect(building.desiredCreeps(snap)).toEqual([]);
      expect(building.roleTargets(snap)).toEqual([{ role: "builder", target: 0 }]);
    });
  });

  describe("intents (cross-room build target assignment)", () => {
    it("does nothing when no room has any outstanding site", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({ siteSummary: [], creeps: [creep] });
      expect(building.intents(snap)).toEqual([]);
    });

    it("assigns an unassigned builder to the nearest room with an outstanding site", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [
          { room: "W3N1", type: "extension" }, // 2 rooms away
          { room: "W1N1", type: "extension" } // home
        ],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([{ kind: "setBuildTargetRoom", creep: creep.id, room: "W1N1" }]);
    });

    it("prefers a nearer remote room's backlog over a farther one", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [
          { room: "W3N1", type: "extension" }, // 2 rooms away
          { room: "W2N1", type: "extension" } // 1 room away
        ],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([{ kind: "setBuildTargetRoom", creep: creep.id, room: "W2N1" }]);
    });

    it("leaves a builder's assignment alone while its current room still has a site", () => {
      const creep = snapCreep("builder", { memory: { buildTargetRoom: "W2N1" } });
      const snap = colonySnap({
        siteSummary: [
          { room: "W1N1", type: "extension" }, // home, nearer — but the builder already has a room
          { room: "W2N1", type: "extension" }
        ],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([]);
    });

    it("reassigns a builder once its current room's backlog is gone", () => {
      const creep = snapCreep("builder", { memory: { buildTargetRoom: "W2N1" } });
      const snap = colonySnap({
        siteSummary: [{ room: "W1N1", type: "extension" }], // W2N1's backlog cleared
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([{ kind: "setBuildTargetRoom", creep: creep.id, room: "W1N1" }]);
    });

    it("ignores non-builder creeps", () => {
      const upgrader = snapCreep("upgrader");
      const snap = colonySnap({ siteSummary: [{ room: "W1N1", type: "extension" }], creeps: [upgrader] });
      expect(building.intents(snap)).toEqual([]);
    });

    // A room reserved by anyone (Invader or a player) or currently dangerous is off-limits to dispatch
    // into: Mining's own staffing gate already stops working sources there (see mining.ts), so a builder
    // walked in would sit uselessly, and unlike Reservation's claimer it has no way to contest either kind.
    it("does not dispatch a builder into a remote room reserved by the Invader NPC", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [{ room: "W2N1", type: "container" }],
        remoteSources: [remoteSourceAt(25, 25, "W2N1", { reservedBy: "Invader" })],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([]);
    });

    it("does not dispatch a builder into a remote room reserved by another player", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [{ room: "W2N1", type: "container" }],
        remoteSources: [remoteSourceAt(25, 25, "W2N1", { reservedBy: "SomePlayer" })],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([]);
    });

    it("does not dispatch a builder into a dangerous remote room", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [{ room: "W2N1", type: "container" }],
        remoteSources: [remoteSourceAt(25, 25, "W2N1", { danger: 1 })],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([]);
    });

    it("still dispatches to a safe remote room while a different remote is reserved", () => {
      const creep = snapCreep("builder");
      const snap = colonySnap({
        siteSummary: [
          { room: "W2N1", type: "container" }, // reserved, unsafe
          { room: "W3N1", type: "extension" } // safe
        ],
        remoteSources: [
          remoteSourceAt(25, 25, "W2N1", { reservedBy: "Invader" }),
          remoteSourceAt(25, 25, "W3N1")
        ],
        creeps: [creep]
      });
      expect(building.intents(snap)).toEqual([{ kind: "setBuildTargetRoom", creep: creep.id, room: "W3N1" }]);
    });
  });
});
