// Scouting is the empire's eyes: it fields scouts to survey the rooms around each colony so remote
// mining and expansion have data to act on. The operation is pure — it reads colony.scoutTargets
// (the room graph, walked at the snapshot boundary) and returns scout demand — so every case here
// constructs the operation and hands it a snapshot, no Game and no map.

import { describe, expect, it } from "vitest";
import { needsScouting, Scouting, staleAfter } from "../../../src/operations/scouting";
import { colonySnap, scouted, scoutTarget, snapCreeps } from "../../fixtures";

const scouting = new Scouting("W1N1");
const scoutRequests = (snap: Parameters<Scouting["desiredCreeps"]>[0]) =>
  scouting.desiredCreeps(snap).filter(r => r.memory.role === "scout");

describe("needsScouting", () => {
  it("wants a room never observed", () => {
    expect(needsScouting(scoutTarget("W1N2"))).toBe(true);
  });

  it("skips a room seen recently", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 90 }));
    expect(needsScouting(target, /*now*/ 100)).toBe(false);
  });

  it("wants a room whose observation has gone stale", () => {
    const target = scoutTarget("W1N2", scouted({ tick: 0 }));
    expect(needsScouting(target, /*now*/ staleAfter("normal") + 1)).toBe(true);
  });

  // A highway carries no controller and no sources — only transient rare resources — so it goes
  // stale far faster than a normal room and is re-surveyed on a short interval.
  it("re-surveys highways much sooner than normal rooms", () => {
    expect(staleAfter("highway")).toBeLessThan(staleAfter("normal"));
  });
});

describe("Scouting demand", () => {
  it("wants nothing when every room in range is freshly scouted", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted()), scoutTarget("W2N1", scouted())]
    });
    expect(scouting.desiredCreeps(snap)).toEqual([]);
  });

  it("wants a scout when a reachable room is unseen", () => {
    const snap = colonySnap({ scoutTargets: [scoutTarget("W1N2")] });
    const reqs = scoutRequests(snap);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].memory.role).toBe("scout");
    expect(reqs[0].memory.op).toBe("scouting:W1N1");
    // A scout is a single MOVE — it only needs to walk, never to work.
    expect(reqs[0].body).toEqual([MOVE]);
  });

  // Legacy sized the fleet at ceil(todo/10) so one scout covers ~10 rooms; a large frontier gets a
  // few scouts, not one per room.
  it("scales the fleet with the size of the todo, roughly one per ten rooms", () => {
    const targets = Array.from({ length: 25 }, (_, i) => scoutTarget(`W1N${i + 2}`));
    const snap = colonySnap({ scoutTargets: targets });
    expect(scoutRequests(snap)).toHaveLength(3); // ceil(25 / 10)
  });

  it("stops asking once it already owns enough scouts", () => {
    const targets = Array.from({ length: 25 }, (_, i) => scoutTarget(`W1N${i + 2}`));
    const snap = colonySnap({
      scoutTargets: targets,
      creeps: snapCreeps("scout", 3, { memory: { op: "scouting:W1N1" } })
    });
    expect(scouting.desiredCreeps(snap)).toEqual([]);
  });

  // The ownership stamp keeps a sibling colony's scouts from counting against this one's demand —
  // the same op-name discipline mining uses.
  it("does not count another operation's scouts", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2"), scoutTarget("W2N1")],
      creeps: snapCreeps("scout", 2, { memory: { op: "scouting:W9N9" } })
    });
    expect(scoutRequests(snap)).toHaveLength(1); // ceil(2/10) wanted, 0 owned
  });

  it("wants nothing when there are no rooms in range yet", () => {
    expect(scouting.desiredCreeps(colonySnap({ scoutTargets: [] }))).toEqual([]);
  });
});
