// Scouting is the empire's eyes: it fields scouts to survey the rooms around each colony so remote
// mining and expansion have data to act on. The operation is pure — it reads colony.scoutTargets
// (the room graph, walked at the snapshot boundary) and returns scout demand — so every case here
// constructs the operation and hands it a snapshot, no Game and no map.

import { describe, expect, it } from "vitest";
import { needsScouting, Scouting, staleAfter } from "../../../src/operations/scouting";
import { colonySnap, scouted, scoutTarget, snapCreep, snapCreeps, visibleRoom } from "../../fixtures";

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

  // The home room is a distance-0 scoutTargets entry (for passive recording), not real frontier work —
  // it must never inflate fleet demand on its own.
  it("does not count the home room toward scout demand", () => {
    const snap = colonySnap({ name: "W1N1", scoutTargets: [scoutTarget("W1N1")] });
    expect(scouting.desiredCreeps(snap)).toEqual([]);
  });
});

// The operation drives its scouts through intents rather than the creep acting on its own: it reads
// each scout's current room from the snapshot, tells it to record a room worth recording, and assigns
// it the next target. Pure — no Game; execute.ts turns these into the live-room read and the route.
describe("Scouting intents", () => {
  // A scout sitting in a room its own frontier still wants surveyed → record it.
  it("records the room a scout stands in when that room is stale", () => {
    const scout = snapCreep("scout", { room: "W1N2", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).toContainEqual({ kind: "recordScout", room: "W1N2" });
  });

  it("does not record a room already freshly scouted", () => {
    const scout = snapCreep("scout", { room: "W1N2", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2", scouted())] });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordScout" }));
  });

  // A scout with no target gets the nearest unscouted room assigned.
  it("assigns an unassigned scout its nearest unscouted target", () => {
    const scout = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N3"), scoutTarget("W1N2")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTarget",
      creep: scout.id,
      targetRoom: "W1N2"
    });
  });

  // A scout that reached its target (standing in it) is reassigned the next room.
  it("reassigns a scout that has arrived at its target", () => {
    const scout = snapCreep("scout", {
      room: "W1N2",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N2" }
    });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N2", scouted()), scoutTarget("W2N1")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTarget",
      creep: scout.id,
      targetRoom: "W2N1"
    });
  });

  // Two adjacent rooms, each other's nearest stale candidate (e.g. two highways restaling faster than
  // the rest of the frontier), must not trap the scout in an infinite back-and-forth: having just
  // arrived from W1N2, it should push on to a third stale room rather than bouncing straight back.
  it("does not send a scout back to the room it just came from while another stale room exists", () => {
    const scout = snapCreep("scout", {
      room: "W1N3",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N3", lastRoom: "W1N2" }
    });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N2"), scoutTarget("W1N3"), scoutTarget("W1N4")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTarget",
      creep: scout.id,
      targetRoom: "W1N4"
    });
  });

  // A scout still en route to a target it hasn't reached is left alone — no reassignment churn.
  it("leaves a scout travelling to an unreached target undisturbed", () => {
    const scout = snapCreep("scout", {
      room: "W1N1",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N2" }
    });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "setScoutTarget" }));
  });

  // Another operation's scout is not driven by this one.
  it("ignores scouts it does not own", () => {
    const scout = snapCreep("scout", { room: "W1N2", memory: { op: "scouting:W9N9" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).toEqual([]);
  });

  it("emits nothing when it owns no scouts", () => {
    const snap = colonySnap({ scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).toEqual([]);
  });

  // Frontier exhausted with a scout alive → push the radius out one ring (execute.ts caps it).
  it("advances the scouting radius when its scouts have surveyed everything in range", () => {
    const scout = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2", scouted())] });
    expect(scouting.intents(snap)).toContainEqual({ kind: "advanceScoutRadius" });
  });

  it("does not advance the radius while any room in range still needs scouting", () => {
    const scout = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).not.toContainEqual({ kind: "advanceScoutRadius" });
  });

  it("does not advance the radius with no scouts to use it", () => {
    const snap = colonySnap({ scoutTargets: [scoutTarget("W1N2", scouted())] });
    expect(scouting.intents(snap)).not.toContainEqual({ kind: "advanceScoutRadius" });
  });

  // A scout is never sent to sit in the colony's own home room — it already has permanent vision —
  // even though the home room is a (distance-0) scoutTargets entry for passive-recording purposes.
  it("never assigns a scout to travel to the colony's own home room", () => {
    const scout = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({
      name: "W1N1",
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N1"), scoutTarget("W1N2")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTarget",
      creep: scout.id,
      targetRoom: "W1N2"
    });
  });
});

// Passive recording: any currently-visible room (not necessarily a scout's target, not necessarily
// even within scouting radius) gets its record refreshed once stale, via ambient vision rather than a
// dispatched scout — see needsPassiveRecording's flat 1500-tick threshold.
describe("Scouting passive recording", () => {
  it("records a visible room that has never been scouted", () => {
    const snap = colonySnap({ visibleRooms: [visibleRoom("W2N5")] });
    expect(scouting.intents(snap)).toContainEqual({ kind: "recordScout", room: "W2N5", passive: true });
  });

  it("records a visible room whose observation has gone stale past the passive interval", () => {
    const snap = colonySnap({
      tick: 2000,
      visibleRooms: [visibleRoom("W2N5", scouted({ tick: 0 }))] // 2000 - 0 >= 1500
    });
    expect(scouting.intents(snap)).toContainEqual({ kind: "recordScout", room: "W2N5", passive: true });
  });

  it("does not record a visible room seen recently enough", () => {
    const snap = colonySnap({
      tick: 1000,
      visibleRooms: [visibleRoom("W2N5", scouted({ tick: 0 }))] // 1000 - 0 < 1500
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ room: "W2N5" }));
  });

  it("does not double-record a room already recorded by the active pass this tick", () => {
    const scout = snapCreep("scout", { room: "W1N2", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N2")],
      visibleRooms: [visibleRoom("W1N2")]
    });
    const intents = scouting.intents(snap);
    const records = intents.filter(i => i.kind === "recordScout" && i.room === "W1N2");
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ kind: "recordScout", room: "W1N2" }); // active wins, no passive flag
  });
});
