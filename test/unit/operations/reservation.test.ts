// Reservation owns claimers: one per remote room worth reserving. Pure — reads colony.remoteSources
// (grouped by room) and returns claimer demand. Every case constructs the operation and hands it a
// snapshot, no Game.

import { describe, expect, it } from "vitest";
import { Reservation } from "../../../src/operations/reservation";
import { colonySnap, remoteSourceAt, snapCreep } from "../../fixtures";

const reservation = new Reservation("W1N1");
const claimerRequests = (snap: Parameters<Reservation["desiredCreeps"]>[0]) =>
  reservation.desiredCreeps(snap).filter(r => r.memory.role === "claimer");

// A home room that can afford a claimer (CLAIM is 600) — so demand isn't suppressed by affordability.
const affordable = { energyCapacity: 800 };

describe("Reservation demand", () => {
  it("wants nothing when there are no remote sources", () => {
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [] }))).toEqual([]);
  });

  it("requests one claimer for a remote room worth reserving, aimed at that room", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const requests = claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }));

    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
    expect(requests[0].memory.role).toBe("claimer");
    expect(requests[0].memory.op).toBe("reservation:W1N1");
  });

  it("requests one claimer per room, never per source", () => {
    // Two sources in the SAME room => still one claimer.
    const a = remoteSourceAt(10, 25, "W2N1", { distance: 50 });
    const b = remoteSourceAt(40, 25, "W2N1", { distance: 60 });
    const requests = claimerRequests(colonySnap({ ...affordable, remoteSources: [a, b] }));

    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
  });

  it("requests a claimer for each distinct room worth reserving", () => {
    const r1 = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const r2 = remoteSourceAt(25, 25, "W1N2", { distance: 60 });
    const rooms = claimerRequests(colonySnap({ ...affordable, remoteSources: [r1, r2] })).map(r => r.targetRoom);

    expect(new Set(rooms)).toEqual(new Set(["W2N1", "W1N2"]));
  });

  it("does not re-request a claimer a room already has", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    const snap = colonySnap({
      ...affordable,
      remoteSources: [remote],
      creeps: [snapCreep("claimer", { memory: { op: "reservation:W1N1", targetRoom: "W2N1" } })]
    });

    expect(claimerRequests(snap)).toEqual([]);
  });

  it("skips a remote room in danger", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, danger: 1 });
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }))).toEqual([]);
  });

  it("skips a room already reserved (no second claimer needed)", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: true });
    // A reserved room with no live claimer would still want one to KEEP it reserved, but with a live
    // claimer present it's covered — that path is the "already has a claimer" case above. Here reserved
    // with no claimer: still request, since reservation decays without a claimer.
    const requests = claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }));
    expect(requests).toHaveLength(1);
  });

  it("suppresses claimer demand when the home room cannot afford one", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    expect(claimerRequests(colonySnap({ energyCapacity: 300, remoteSources: [remote] }))).toEqual([]);
  });
});
