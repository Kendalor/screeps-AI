// Colonize owns one colonizer (claims the target's controller) and up to MAX_SETTLERS settler creeps
// (bootstrap the room once claimed), both aimed at its constructor-supplied targetRoom. Not wired into
// operationsFor (no colony gets this by default) — constructed directly here, same as any other
// operation under test.

import { describe, expect, it } from "vitest";
import { Colonize, MAX_SETTLERS, SELF_SUFFICIENT_ENERGY_CAP } from "../../../src/operations/colonize";
import { colonySnap, snapCreep } from "../../fixtures";

const colonize = (target: string, targetEnergyCapacity?: number) => new Colonize("W1N1", target, targetEnergyCapacity);

// Colonizer body floors at 650 (1 CLAIM + 1 MOVE) — flat, unlike the reserving claimer's 2-set floor.
const COLONIZER_AFFORDABLE = { energyCapacity: 650 };
const requestsByRole = (requests: { memory: { role: string } }[], role: string) => requests.filter(r => r.memory.role === role);

describe("Colonize colonizer demand", () => {
  it("requests one colonizer aimed at the target room", () => {
    const requests = requestsByRole(colonize("W2N1").desiredCreeps(colonySnap(COLONIZER_AFFORDABLE)), "colonizer");

    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
    expect(requests[0].memory.op).toBe("colonize:W1N1");
  });

  it("does not re-request a colonizer already sent to the target", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W2N1" } })]
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "colonizer")).toEqual([]);
  });

  it("still requests when a live colonizer is aimed at a different target", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W3N1" } })]
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "colonizer")).toHaveLength(1);
  });

  it("ignores a colonizer owned by a different operation instance at the same target", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W9N9", targetRoom: "W2N1" } })]
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "colonizer")).toHaveLength(1);
  });

  it("suppresses colonizer demand when the home room cannot afford one", () => {
    expect(requestsByRole(colonize("W2N1").desiredCreeps(colonySnap({ energyCapacity: 600 })), "colonizer")).toEqual([]);
  });
});

describe("Colonize settler demand", () => {
  it("requests a settler in parallel with the colonizer", () => {
    const requests = requestsByRole(colonize("W2N1").desiredCreeps(colonySnap(COLONIZER_AFFORDABLE)), "settler");
    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
    expect(requests[0].memory.op).toBe("colonize:W1N1");
  });

  it("still requests a settler even when the room can't yet afford a colonizer", () => {
    // 600 energy: below COLONIZER_COST (650) but above SETTLER_MIN_COST.
    const requests = requestsByRole(colonize("W2N1").desiredCreeps(colonySnap({ energyCapacity: 600 })), "settler");
    expect(requests).toHaveLength(1);
  });

  it("stops requesting once MAX_SETTLERS are already owned for this target", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: Array.from({ length: MAX_SETTLERS }, () => snapCreep("settler", { memory: { op: "colonize:W1N1", targetRoom: "W2N1" } }))
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "settler")).toEqual([]);
  });

  it("still requests below MAX_SETTLERS", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: Array.from({ length: MAX_SETTLERS - 1 }, () => snapCreep("settler", { memory: { op: "colonize:W1N1", targetRoom: "W2N1" } }))
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "settler")).toHaveLength(1);
  });

  it("does not count a settler aimed at a different target toward this target's cap", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: Array.from({ length: MAX_SETTLERS }, () => snapCreep("settler", { memory: { op: "colonize:W1N1", targetRoom: "W3N1" } }))
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "settler")).toHaveLength(1);
  });

  it("stops requesting once a colonizer at this target has hit a terminal claim error (room already owned)", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W2N1", claimError: ERR_ACCESS_DENIED } })]
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "settler")).toEqual([]);
  });

  it("keeps requesting through a retryable claim error (GCL not enough)", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W2N1", claimError: ERR_GCL_NOT_ENOUGH } })]
    });
    expect(requestsByRole(colonize("W2N1").desiredCreeps(snap), "settler")).toHaveLength(1);
  });

  it("stops requesting once the target has reached the self-sufficient energy cap", () => {
    const requests = requestsByRole(
      colonize("W2N1", SELF_SUFFICIENT_ENERGY_CAP).desiredCreeps(colonySnap(COLONIZER_AFFORDABLE)),
      "settler"
    );
    expect(requests).toEqual([]);
  });

  it("still requests below the self-sufficient energy cap", () => {
    const requests = requestsByRole(
      colonize("W2N1", SELF_SUFFICIENT_ENERGY_CAP - 1).desiredCreeps(colonySnap(COLONIZER_AFFORDABLE)),
      "settler"
    );
    expect(requests).toHaveLength(1);
  });
});

describe("Colonize removal (intents)", () => {
  it("emits nothing while the target is still in progress", () => {
    const snap = colonySnap(COLONIZER_AFFORDABLE);
    expect(colonize("W2N1").intents(snap)).toEqual([]);
  });

  it("emits nothing while below the self-sufficient energy cap", () => {
    const snap = colonySnap(COLONIZER_AFFORDABLE);
    expect(colonize("W2N1", SELF_SUFFICIENT_ENERGY_CAP - 1).intents(snap)).toEqual([]);
  });

  it("removes the target once it reaches the self-sufficient energy cap", () => {
    const snap = colonySnap(COLONIZER_AFFORDABLE);
    expect(colonize("W2N1", SELF_SUFFICIENT_ENERGY_CAP).intents(snap)).toEqual([
      { kind: "removeColonizeTarget", room: "W1N1", target: "W2N1" }
    ]);
  });

  it("removes the target once the colonizer hits a terminal claim error", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W2N1", claimError: ERR_ACCESS_DENIED } })]
    });
    expect(colonize("W2N1").intents(snap)).toEqual([{ kind: "removeColonizeTarget", room: "W1N1", target: "W2N1" }]);
  });

  it("does not remove the target on a retryable claim error", () => {
    const snap = colonySnap({
      ...COLONIZER_AFFORDABLE,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W2N1", claimError: ERR_GCL_NOT_ENOUGH } })]
    });
    expect(colonize("W2N1").intents(snap)).toEqual([]);
  });
});
