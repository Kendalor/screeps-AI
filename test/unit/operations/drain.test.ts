// Drain sends a fixed 4-creep squad (1 drainAttacker + 3 drainHealer) at a single target room
// (ColonyMemory.draining, snapshot.draining) — see docs/adr/0006-drain-energy-operation.md. Constructed
// directly here (new Drain("W1N1")), same as Attack/Defense's test convention: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Drain, leaderOf, pickStagingRoom } from "../../../src/operations/drain";
import { DRAIN_ATTACKER_MIN_COST } from "../../../src/behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../../../src/behaviors/roles/drainHealer";
import { colonySnap, snapCreep, towerAt, visibleRoom } from "../../fixtures";

const drain = new Drain("W1N1");

const DRAIN_AFFORDABLE = { energyCapacity: DRAIN_ATTACKER_MIN_COST + 3 * DRAIN_HEALER_MIN_COST };
const requestsByRole = (requests: { memory: { role: string } }[], role: string) => requests.filter(r => r.memory.role === role);

describe("Drain.desiredCreeps", () => {
  it("requests 1 attacker and 3 healers when draining is set and nothing is owned yet", () => {
    const snap = colonySnap({ ...DRAIN_AFFORDABLE, draining: "W2N1" });
    const requests = drain.desiredCreeps(snap);

    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(1);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(3);
    for (const r of requests) expect(r.memory.op).toBe("drain:W1N1");
  });

  it("requests nothing when draining is unset", () => {
    const snap = colonySnap({ ...DRAIN_AFFORDABLE, draining: undefined });
    expect(drain.desiredCreeps(snap)).toEqual([]);
  });

  it("tops up only the missing healers once the attacker and some healers are already owned", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    const requests = drain.desiredCreeps(snap);
    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(0);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(2);
  });

  it("requests nothing once the full 1 attacker + 3 healer composition is already owned", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    expect(drain.desiredCreeps(snap)).toEqual([]);
  });

  // #39: loss handling has no special case for "how" a squad member went missing — desiredCreeps only
  // ever compares live count-by-role against the fixed composition, so a squad short by exactly 1 (of
  // either death or ticksToLive expiry, indistinguishable in a snapshot) requests exactly that 1 back.
  it("requests exactly the 1 missing healer when the squad is short by one (below full strength, not zero)", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    const requests = drain.desiredCreeps(snap);
    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(0);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(1);
  });
});

// A full squad fixture: 1 drainAttacker + 3 drainHealer sharing drain.name, positioned in `room`
// (defaults to the staging room "W1N5") unless overridden per-creep.
function squad(over: { room?: string; attacker?: Partial<Parameters<typeof snapCreep>[1]>; healers?: Partial<Parameters<typeof snapCreep>[1]>[] } = {}) {
  const room = over.room ?? "W1N5";
  const attacker = snapCreep("drainAttacker", { room, memory: { op: drain.name }, ...over.attacker });
  const healers = [0, 1, 2].map(i =>
    snapCreep("drainHealer", { room, memory: { op: drain.name }, ...(over.healers?.[i] ?? {}) })
  );
  return [attacker, ...healers];
}

const STAGING_ROUTE = [
  { room: "W1N3", hostile: true },
  { room: "W1N5", hostile: false }, // staging room
  { room: "W2N1", hostile: true }
];

describe("Drain.intents assembly gate", () => {
  it("holds every squad member in the staging room (attackTargetRoom) when the squad isn't fully assembled", () => {
    // Only the attacker and one healer are alive — short of the fixed 1+3 composition — and neither has
    // reached the staging room yet (still travelling from home).
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      creeps: [
        snapCreep("drainAttacker", { room: "W1N1", memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { room: "W1N1", memory: { op: "drain:W1N1" } })
      ]
    });
    const intents = drain.intents(snap);
    expect(intents).toContainEqual({ kind: "setAttackTargetRoom", creep: expect.any(String), room: "W1N5" });
    expect(intents.some(i => i.kind === "setSquadTargetPos")).toBe(false);
  });

  it("holds a fully-assembled squad in the staging room until every member is actually present together", () => {
    // All 4 alive, but one healer is still elsewhere (e.g. mid-spawn-travel), not yet in the staging room.
    const members = squad();
    members[3] = { ...members[3], room: "W1N3" }; // third healer not yet in staging
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: members });
    const intents = drain.intents(snap);
    expect(intents.some(i => i.kind === "setSquadTargetPos" && (i as { pos: { room: string } }).pos.room !== "W1N5")).toBe(false);
  });
});

describe("Drain.intents leader selection + advance/retreat", () => {
  it("leads with the attacker, advancing it toward the target room when no towers threaten it", () => {
    const attacker = snapCreep("drainAttacker", { room: "W1N5", memory: { op: "drain:W1N1" } });
    const healers = [0, 1, 2].map(() => snapCreep("drainHealer", { room: "W1N5", memory: { op: "drain:W1N1" } }));
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: [attacker, ...healers] });

    const intents = drain.intents(snap);
    const leaderIntent = intents.find(i => i.kind === "setSquadTargetPos" && i.creep === attacker.id);
    expect(leaderIntent).toBeDefined();
    expect((leaderIntent as { pos: { room: string } }).pos.room).toBe("W2N1"); // advancing into the target room
  });

  it("advances the leader deeper (not just room membership) when no towers threaten the target room", () => {
    // Leader already standing in the target room, one tile off-center; with zero towers visible the
    // advance check is unconditionally safe, so the leader steps one tile closer to room-center (25,25).
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } });
    const healers = [0, 1, 2].map(() => snapCreep("drainHealer", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } }));
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: [attacker, ...healers] });

    const intents = drain.intents(snap);
    const leaderIntent = intents.find(i => i.kind === "setSquadTargetPos" && i.creep === attacker.id) as
      | { pos: { x: number; y: number; room: string } }
      | undefined;
    expect(leaderIntent?.pos).toEqual({ x: 25, y: 29, room: "W2N1" }); // one tile toward (25,25)
  });

  it("denies advance and retreats one step toward the staging room when projected tower damage exceeds heal output", () => {
    // A single tower at range 5 (optimal, 600 dmg) from the leader's next candidate tile; 3 healers with
    // the fixture's default plain [WORK,CARRY,MOVE] body (0 HEAL parts) heal for 0 — comfortably outgunned.
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } });
    const healers = [0, 1, 2].map(() => snapCreep("drainHealer", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } }));
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      hostileRoomTowers: { W2N1: [towerAt(25, 25)] },
      creeps: [attacker, ...healers]
    });

    const intents = drain.intents(snap);
    const leaderIntent = intents.find(i => i.kind === "setSquadTargetPos" && i.creep === attacker.id) as
      | { pos: { x: number; y: number; room: string } }
      | undefined;
    // Retreating: aimed at the staging room (moveToPos's travelTo moves 1 tile/tick toward it regardless
    // of how far the aim point itself is — same "hand travelTo a RoomPosition, it paths there
    // incrementally" convention moveToRoom already uses for cross-room travel).
    expect(leaderIntent?.pos).toEqual({ x: 25, y: 25, room: "W1N5" });
  });

  it("allows advance when the squad's heal output covers the projected tower damage", () => {
    const HEAL_BODY = Array(20).fill(HEAL).concat(Array(20).fill(MOVE));
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } });
    const healers = [0, 1, 2].map(() =>
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 30, body: HEAL_BODY, memory: { op: "drain:W1N1" } })
    );
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      hostileRoomTowers: { W2N1: [towerAt(25, 25)] },
      creeps: [attacker, ...healers]
    });

    const intents = drain.intents(snap);
    const leaderIntent = intents.find(i => i.kind === "setSquadTargetPos" && i.creep === attacker.id) as
      | { pos: { x: number; y: number; room: string } }
      | undefined;
    expect(leaderIntent?.pos).toEqual({ x: 25, y: 29, room: "W2N1" }); // advancing, one tile toward (25,25)
  });

  it("falls back to the alphabetically-first healer as leader when no attacker is present", () => {
    // A 3-healer-only squad never satisfies the fixed 1+3 composition, so this exercises leaderOf's
    // fallback directly through the exported pure helper rather than through intents() (which would hold
    // position at the assembly gate for an attacker-less squad — see ADR 0006's "death and expiry share
    // one path", #39's scope, not #37's).
    const healers = [
      snapCreep("drainHealer", { name: "zzz_healer" }),
      snapCreep("drainHealer", { name: "aaa_healer" }),
      snapCreep("drainHealer", { name: "mmm_healer" })
    ];
    expect(leaderOf(undefined, healers).name).toBe("aaa_healer");
  });

  it("moves every follower to its formation offset alongside the leader", () => {
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } });
    const healers = [0, 1, 2].map(() => snapCreep("drainHealer", { room: "W2N1", x: 25, y: 30, memory: { op: "drain:W1N1" } }));
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: [attacker, ...healers] });

    const intents = drain.intents(snap);
    const followerIntents = intents.filter(i => i.kind === "setSquadTargetPos" && i.creep !== attacker.id);
    expect(followerIntents).toHaveLength(3);
  });
});

// #39: loss handling. A squad-mate can go missing (combat death, or ticksToLive hitting zero) at any
// point, including mid-advance already inside the target room — not just before the first push out of
// staging. ADR 0006's "death and expiry share one path" means the fixture never distinguishes *why* a
// creep is missing; a fixture simply omitting a creep IS the expiry case as much as the death case.
describe("Drain.intents loss handling (#39)", () => {
  it("retreats survivors toward the staging room when caught below strength INSIDE the target room", () => {
    // 1 attacker + 2 healers (1 healer missing/lost) already standing in the target room W2N1 — as if
    // caught mid-advance when the loss happened, not merely still en route to staging.
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } });
    const healers = [0, 1].map(() => snapCreep("drainHealer", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } }));
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: [attacker, ...healers] });

    const intents = drain.intents(snap);
    // Every survivor gets sent back toward the staging room (attackTargetRoom drives moveToRoom, which
    // paths across room borders same as it does for the outbound leg — see behaviors/roles/drainAttacker
    // and drainHealer's `moveToRoom { to: "attackTargetRoom" }` step).
    expect(intents).toHaveLength(3);
    for (const c of [attacker, ...healers]) {
      expect(intents).toContainEqual({ kind: "setAttackTargetRoom", creep: c.id, room: "W1N5" });
    }
    // Not still trying to advance/hold a squad formation position while understaffed and out of position.
    expect(intents.some(i => i.kind === "setSquadTargetPos")).toBe(false);
  });

  it("does not advance again until back to full strength AND reassembled together in the staging room", () => {
    // Full strength (4 alive) but only 3 have reached the staging room; the 4th (a healer) is still
    // mid-retreat, one room short. Mirrors the pre-existing "assembly gate" test, but framed as the
    // post-loss reassembly leg (#39) rather than the first-ever push (#37).
    const members = squad();
    members[3] = { ...members[3], room: "W1N3" }; // one healer not yet back in staging
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: members });

    const intents = drain.intents(snap);
    expect(intents.some(i => i.kind === "setSquadTargetPos")).toBe(false);
  });

  it("resumes advancing toward the same target automatically once reassembled at full strength, no new trigger", () => {
    // All 4 members now physically together in the staging room (the tick after reassembly completes) —
    // same colony.draining target as before, no flag/CLI/extra memory needed to resume.
    const members = squad();
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: members });

    const intents = drain.intents(snap);
    const leaderIntent = intents.find(i => i.kind === "setSquadTargetPos" && i.creep === members[0].id);
    expect(leaderIntent).toBeDefined();
    expect((leaderIntent as { pos: { room: string } }).pos.room).toBe("W2N1"); // advancing into the target room again
  });

  it("behaves identically for a fixture representing combat death and one representing ticksToLive expiry", () => {
    // ADR 0006: "no ticksToLive-specific branch anywhere" — both causes of loss collapse to the same
    // observable fact (a squad-mate missing from the snapshot), so two fixtures built to represent each
    // cause, but otherwise identical, must produce byte-identical intents.
    const deathFixtureCreeps = [
      snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } })
      // third healer: killed by hostile creeps this tick, simply absent from the snapshot.
    ];
    const expiryFixtureCreeps = [
      snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } })
      // third healer: ticksToLive hit 0 and it was recycled/despawned, simply absent from the snapshot —
      // indistinguishable from the death case in a colonySnap fixture (SnapCreep carries no ticksToLive
      // field at all), which is exactly ADR 0006's point.
    ];
    const deathSnap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: deathFixtureCreeps });
    const expirySnap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, creeps: expiryFixtureCreeps });

    const deathIntents = drain.intents(deathSnap).map(i => ({ ...i, creep: undefined }));
    const expiryIntents = drain.intents(expirySnap).map(i => ({ ...i, creep: undefined }));
    expect(deathIntents).toEqual(expiryIntents);
  });
});

describe("Drain.intents drainHistory sample (#40)", () => {
  it("records a sample (tick, tower energy, storage energy) when the target room is visible", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({
      tick: 123,
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      hostileRoomTowers: { W2N1: [towerAt(25, 25, "t1", 400), towerAt(10, 10, "t2", 200)] },
      hostileRoomStorageEnergy: { W2N1: 5000 },
      visibleRooms: [visibleRoom("W2N1")],
      creeps: members
    });

    const intents = drain.intents(snap);
    expect(intents).toContainEqual({
      kind: "recordDrainSample",
      room: "W1N1",
      target: "W2N1",
      tick: 123,
      towerEnergy: 600, // summed across both visible towers
      storageEnergy: 5000
    });
  });

  it("records no sample (a gap, not a zero-filled entry) on a tick without vision of the target room", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({
      tick: 124,
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      // No vision this tick: visibleRooms doesn't include W2N1, even though stale hostileRoomTowers/
      // hostileRoomStorageEnergy data might still be lying around from an earlier tick's snapshot.
      hostileRoomTowers: { W2N1: [towerAt(25, 25, "t1", 400)] },
      hostileRoomStorageEnergy: { W2N1: 5000 },
      visibleRooms: [],
      creeps: members
    });

    const intents = drain.intents(snap);
    expect(intents.some(i => i.kind === "recordDrainSample")).toBe(false);
  });
});

describe("pickStagingRoom", () => {
  it("picks the first non-hostile room along the route", () => {
    const route = [
      { room: "W2N1", hostile: true },
      { room: "W3N1", hostile: false },
      { room: "W4N1", hostile: true }
    ];
    expect(pickStagingRoom(route)).toBe("W3N1");
  });

  it("treats an unscouted room (hostile: false, the fixture default) as safe", () => {
    const route = [
      { room: "W2N1", hostile: true },
      { room: "W3N1", hostile: false }
    ];
    expect(pickStagingRoom(route)).toBe("W3N1");
  });

  it("returns undefined when every room along the route is hostile", () => {
    const route = [
      { room: "W2N1", hostile: true },
      { room: "W3N1", hostile: true }
    ];
    expect(pickStagingRoom(route)).toBeUndefined();
  });

  it("returns undefined for an empty route", () => {
    expect(pickStagingRoom([])).toBeUndefined();
  });
});
