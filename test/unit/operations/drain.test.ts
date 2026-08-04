// Drain sends a fixed 4-creep squad (1 drainAttacker + 3 drainHealer) at a single target room
// (ColonyMemory.draining, snapshot.draining) — see docs/adr/0006-drain-energy-operation.md. Constructed
// directly here (new Drain("W1N1")), same as Attack/Defense's test convention: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Drain, leaderOf, pickStagingRoom } from "../../../src/operations/drain";
import { DRAIN_ATTACKER_MIN_COST } from "../../../src/behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../../../src/behaviors/roles/drainHealer";
import { colonySnap, snapCreep, towerAt } from "../../fixtures";

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
