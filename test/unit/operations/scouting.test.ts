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

  // If a whole frontier is boxed in behind a hostile-owned transit room recently proven lethal
  // (dangerRouteCost in execute.ts prices it Infinity), every candidate is unreachable and the existing
  // scout ends up parked in the home room with no target and no lastRoom — see strandedScout's doc.
  // Requesting a second scout in that state would just idle it too: the frontier hasn't changed.
  it("withholds new requests once an existing scout is stranded with nowhere reachable to go", () => {
    const stranded = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({
      name: "W1N1",
      creeps: [stranded],
      scoutTargets: [scoutTarget("W1N2"), scoutTarget("W1N3")]
    });
    expect(scouting.desiredCreeps(snap)).toEqual([]);
  });

  // A scout standing in the home room while still travelling TO somewhere (lastRoom set from a prior
  // assignment) is not stranded — it's between legitimate hops — so demand keeps flowing normally.
  it("still requests scouts when the existing scout is merely between assignments, not stranded", () => {
    const travelling = snapCreep("scout", {
      room: "W1N1",
      memory: { op: "scouting:W1N1", lastRoom: "W1N2" }
    });
    const targets = Array.from({ length: 25 }, (_, i) => scoutTarget(`W1N${i + 4}`));
    const snap = colonySnap({ name: "W1N1", creeps: [travelling], scoutTargets: targets });
    expect(scoutRequests(snap)).toHaveLength(2); // ceil(25/10) wanted=3, 1 owned
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

  // A scout with no target gets the pool of unscouted rooms as candidates — execute.ts assigns the
  // nearest of those (jointly across all idle scouts) via Game.map.findRoute.
  it("assigns an unassigned scout the pool of unscouted candidates", () => {
    const scout = snapCreep("scout", { room: "W1N1", memory: { op: "scouting:W1N1" } });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N3"), scoutTarget("W1N2")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTargets",
      assignments: [{ creep: scout.id, candidates: ["W1N3", "W1N2"] }]
    });
  });

  // A scout that reached its target (standing in it) is reassigned from the remaining candidates.
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
      kind: "setScoutTargets",
      assignments: [{ creep: scout.id, candidates: ["W2N1"] }]
    });
  });

  // Two adjacent rooms, each other's nearest stale candidate (e.g. two highways restaling faster than
  // the rest of the frontier), must not trap the scout in an infinite back-and-forth: having just
  // arrived from W1N2, the candidate pool should push on to the third stale room rather than including
  // the one just left.
  it("excludes the room a scout just came from while another stale room exists", () => {
    const scout = snapCreep("scout", {
      room: "W1N3",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N3", lastRoom: "W1N2" }
    });
    const snap = colonySnap({
      creeps: [scout],
      scoutTargets: [scoutTarget("W1N2"), scoutTarget("W1N3"), scoutTarget("W1N4")]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTargets",
      assignments: [{ creep: scout.id, candidates: ["W1N4"] }]
    });
  });

  // A scout still en route to a target it hasn't reached is left alone — no reassignment churn.
  it("leaves a scout travelling to an unreached target undisturbed", () => {
    const scout = snapCreep("scout", {
      room: "W1N1",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N2" }
    });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "setScoutTargets" }));
  });

  // A scout can be assigned a target that the frontier walk later stops offering at all — e.g. it turns
  // out to sit across a respawn/novice zone boundary (see scoutGraph.ts's status-match filter): the room
  // is walled off, so the scout can never arrive and "still travelling" would otherwise leave it pointed
  // at that target forever. It must be reassigned from whatever's still actually in scoutTargets, exactly
  // like a scout that already arrived.
  it("reassigns a scout whose target has dropped out of scoutTargets entirely", () => {
    const scout = snapCreep("scout", {
      room: "W1N1",
      memory: { op: "scouting:W1N1", scoutTarget: "W1N9" } // W1N9 no longer a candidate at all
    });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "setScoutTargets",
      assignments: [{ creep: scout.id, candidates: ["W1N2"] }]
    });
  });

  // Another operation's scout is not driven by this one.
  it("ignores scouts it does not own", () => {
    const scout = snapCreep("scout", { room: "W1N2", memory: { op: "scouting:W9N9" } });
    const snap = colonySnap({ creeps: [scout], scoutTargets: [scoutTarget("W1N2")] });
    expect(scouting.intents(snap)).toEqual([]);
  });

  it("emits nothing when it owns no scouts and the frontier still has unscouted rooms", () => {
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

  // A boxed-in frontier (everything in range already fresh/filtered out) must still be able to grow
  // even with zero scouts alive — otherwise nothing would ever spawn one to trigger the advance,
  // wedging the radius forever (see scouting.ts's nothingToDo comment).
  it("advances the radius even with no scouts alive, once everything in range is fresh", () => {
    const snap = colonySnap({ scoutTargets: [scoutTarget("W1N2", scouted())] });
    expect(scouting.intents(snap)).toContainEqual({ kind: "advanceScoutRadius" });
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
      kind: "setScoutTargets",
      assignments: [{ creep: scout.id, candidates: ["W1N2"] }]
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

// pickRemotes ranks/prices on a source's real PathFinder distance when it's cached, falling back to a
// cheap estimate otherwise (see mining/pickRemotes.ts) — so scouting precomputes that real distance for
// every in-range scouted source ahead of time, rather than pickRemotes ever calling PathFinder itself.
describe("Scouting source-path precompute", () => {
  it("emits recordSourcePath for an in-range scouted source with no cached path yet", () => {
    const snap = colonySnap({
      anchor: { x: 25, y: 25 },
      scoutTargets: [scoutTarget("W1N2", scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10 }] }))]
    });
    expect(scouting.intents(snap)).toContainEqual({
      kind: "recordSourcePath",
      home: "W1N1",
      room: "W1N2",
      anchor: { x: 25, y: 25 },
      source: "s1"
    });
  });

  it("stays silent for a source that already has a cached path for this home room", () => {
    const snap = colonySnap({
      anchor: { x: 25, y: 25 },
      scoutTargets: [
        scoutTarget(
          "W1N2",
          scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10, paths: { W1N1: "121" } }] })
        )
      ]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
  });

  it("stays silent with no anchor placed yet", () => {
    const snap = colonySnap({
      anchor: null,
      scoutTargets: [scoutTarget("W1N2", scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10 }] }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
  });

  it("skips a candidate beyond MAX_REMOTE_HOPS even with an anchor and a source", () => {
    const tooFar = {
      room: "W5N1",
      distance: 4, // MAX_REMOTE_HOPS is 3
      type: "normal" as const,
      info: scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10 }] })
    };
    const snap = colonySnap({ anchor: { x: 25, y: 25 }, scoutTargets: [tooFar] });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
  });

  it("skips the home room and unscouted candidates", () => {
    const snap = colonySnap({
      name: "W1N1",
      anchor: { x: 25, y: 25 },
      scoutTargets: [scoutTarget("W1N1", scouted()), scoutTarget("W1N3") /* no info */]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
  });

  // The actual bug this negative cache fixes: a source PathFinder can never reach (e.g. a blocked
  // border) has no `paths` entry to ever get cached, so without noPathAt this re-emits (and
  // execute.ts re-runs PathFinder.search for) the exact same failing source every single tick forever.
  describe("noPathAt backoff", () => {
    it("stays silent for a source whose last search failed within the backoff window", () => {
      const snap = colonySnap({
        tick: 5000,
        anchor: { x: 25, y: 25 },
        scoutTargets: [
          scoutTarget(
            "W1N2",
            scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10, noPathAt: { W1N1: 4999 } }] })
          )
        ]
      });
      expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
    });

    it("retries once the backoff window has elapsed", () => {
      const snap = colonySnap({
        tick: 30000,
        anchor: { x: 25, y: 25 },
        scoutTargets: [
          scoutTarget(
            "W1N2",
            scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10, noPathAt: { W1N1: 5000 } }] })
          )
        ]
      });
      expect(scouting.intents(snap)).toContainEqual({
        kind: "recordSourcePath",
        home: "W1N1",
        room: "W1N2",
        anchor: { x: 25, y: 25 },
        source: "s1"
      });
    });

    it("a noPathAt recorded for a DIFFERENT home doesn't block this home's precompute", () => {
      const snap = colonySnap({
        tick: 5000,
        anchor: { x: 25, y: 25 },
        scoutTargets: [
          scoutTarget(
            "W1N2",
            scouted({ sources: [{ id: "s1" as Id<Source>, x: 10, y: 10, noPathAt: { W9N9: 4999 } }] })
          )
        ]
      });
      expect(scouting.intents(snap)).toContainEqual(expect.objectContaining({ kind: "recordSourcePath" }));
    });
  });
});

// The map-topology colonization score (ScoutInfo.potential) is only worth computing for a room that
// could actually host a colony, so this planner only decides WHICH rooms are candidates; execute.ts does
// the real describeExits BFS and the "is the neighborhood fully scouted yet" readiness check.
describe("Scouting potential precompute", () => {
  it("emits recordPotential for a scouted, anchor-viable, unowned room that hasn't been checked yet", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted({ anchor: { x: 25, y: 25 } }))]
    });
    expect(scouting.intents(snap)).toContainEqual({ kind: "recordPotential", room: "W1N2" });
  });

  it("stays silent once potentialChecked is already true", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted({ anchor: { x: 25, y: 25 }, potentialChecked: true }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for a room with no anchor — it can never be colonized regardless of its neighborhood", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted({ anchorChecked: true }))] // checked, no fit found
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for an owned room", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted({ anchor: { x: 25, y: 25 }, owner: "someoneElse" }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for a hostile room", () => {
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W1N2", scouted({ anchor: { x: 25, y: 25 }, hostile: true }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for an unscouted candidate — no anchor data to gate on", () => {
    const snap = colonySnap({ scoutTargets: [scoutTarget("W1N2")] }); // no info at all
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for a keeper/highway room — only normal rooms host a colony", () => {
    // W5N5 is a genuine keeper-band room name (5 % 10 is within [4,6]) — scoutTarget derives
    // ScoutCandidate.type from the room NAME via roomType(), not from the info override, so the
    // candidate's own type must actually be keeper for this gate to be exercised.
    const snap = colonySnap({
      scoutTargets: [scoutTarget("W5N5", scouted({ type: "keeper", anchor: { x: 25, y: 25 } }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });

  it("stays silent for the colony's own home room", () => {
    const snap = colonySnap({
      name: "W1N1",
      scoutTargets: [scoutTarget("W1N1", scouted({ anchor: { x: 25, y: 25 } }))]
    });
    expect(scouting.intents(snap)).not.toContainEqual(expect.objectContaining({ kind: "recordPotential" }));
  });
});
