// Automatic counterpart to attackFlags: sweeps every room within PRUNE_RADIUS of a colony (not just its
// selected remote-mining rooms) for one reserved by the Invader NPC with a live, non-fortified core
// still standing, and hands the target off via the same pickAttackSponsor/addAttackTarget pipeline the
// manual flag uses. Same test style as attackFlags.test.ts, driven by
// colony.snapshot.scoutTargets/visibleRooms instead of Game.flags.

import { describe, expect, it } from "vitest";
import { runRemoteInvaderAttacks } from "../../../src/empire/remoteInvaderAttacks";
import { ATTACKER_MIN_COST } from "../../../src/behaviors/roles/attacker";
import { testEmpire, colonySnap, scoutTarget, scouted, visibleRoom } from "../../fixtures";
import { stubGame } from "../../helpers";

function setUp() {
  stubGame();
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  // addAttackTarget's handler writes Memory.colonies[room] — stubGame() only seeds Memory.creeps.
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const attackingOf = (mem: Record<string, unknown>, room: string): string[] =>
  ((mem as { colonies?: Record<string, { attacking?: string[] }> }).colonies?.[room]?.attacking) ?? [];

// A room 3 hops out (Chebyshev, matching the fixture's roomLinearDistance-based scoutTarget helper) —
// the edge of PRUNE_RADIUS.
const NEAR_ROOM = "W4N1"; // distance 3 from W1N1

describe("runRemoteInvaderAttacks", () => {
  it("does nothing when no scouted room is reserved by Invader", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Someone", hostile: true }))]
      })
    );

    expect(() => runRemoteInvaderAttacks(world)).not.toThrow();
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("attacks a room reserved by Invader within range, with a live level-0 core", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 1, 0)]
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([NEAR_ROOM]);
  });

  it("does not trigger for an unmined room beyond PRUNE_RADIUS", () => {
    setUp();
    const far = "W9N1"; // distance 8 from W1N1
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(far, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(far, undefined, 1, 0)]
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not trigger for a real player's reservation", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "SomePlayer", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 1, 0)]
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  // The whole point of the "not feasible" carve-out: a Stronghold's fortified core (level 1-5) must
  // never be auto-attacked, even though its room can also read as Invader-reserved.
  it("does not trigger for a fortified Stronghold core (level > 0)", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 1, 3)]
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not trigger without vision confirming the core is still there", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [] // never seen this tick
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not trigger once vision shows no core at all", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 0)] // cleared, no invaderCoreLevel
      })
    );

    runRemoteInvaderAttacks(world);

    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not re-trigger when the target is already being attacked", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 1, 0)],
        attacking: [NEAR_ROOM]
      })
    );

    runRemoteInvaderAttacks(world);

    // No duplicate handoff — Memory was never written this time (dedup short-circuits first).
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does nothing when no colony can afford an attacker", () => {
    setUp();
    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: ATTACKER_MIN_COST - 1,
        scoutTargets: [scoutTarget(NEAR_ROOM, scouted({ owner: "Invader", hostile: true }))],
        visibleRooms: [visibleRoom(NEAR_ROOM, undefined, 1, 0)]
      })
    );

    expect(() => runRemoteInvaderAttacks(world)).not.toThrow();
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });
});
