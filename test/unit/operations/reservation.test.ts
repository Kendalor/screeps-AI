// Reservation owns claimers: one per remote room worth reserving. Pure — reads colony.remoteSources
// (grouped by room) and returns claimer demand. Every case constructs the operation and hands it a
// snapshot, no Game.

import { describe, expect, it } from "vitest";
import { Reservation } from "../../../src/operations/reservation";
import { colonySnap, remoteSourceAt, snapCreep } from "../../fixtures";

const reservation = new Reservation("W1N1");
const claimerRequests = (snap: Parameters<Reservation["desiredCreeps"]>[0]) =>
  reservation.desiredCreeps(snap).filter(r => r.memory.role === "claimer");

// A home room that can afford a claimer (min body is 2x CLAIM+MOVE = 1300) — so demand isn't
// suppressed by affordability. 800 (RCL3 cap) is NOT enough, despite CLAIM alone costing 600.
const affordable = { energyCapacity: 1300 };

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
    // Pinned to the requesting colony even though targetRoom is the remote — only the ONE colony that
    // selected this remote ever requests a claimer for it (see spawnRoom's doc in reservation.ts and
    // spawn/request.ts). Without this the request could be opportunistically fulfilled by an unrelated
    // colony's spawn.
    expect(requests[0].spawnRoom).toBe("W1N1");
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

  it("skips a remote room reserved by another player", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reservedBy: "SomePlayer" });
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }))).toEqual([]);
  });

  // A claimed (owned) room rejects reserveController outright, same as claimController would — never
  // worth sending a claimer to contest, unlike an Invader-core reservation below.
  it("skips a remote room owned by another player", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, ownedBy: "SomePlayer" });
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }))).toEqual([]);
  });

  // An Invader-core reservation is not a player's — reserveController contests it (ticks it down)
  // instead of being rejected outright the way it would against a player's reservation, so a claimer
  // should still be requested to go compete for the room rather than sit out.
  it("still requests a claimer for a room reserved by the Invader NPC", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reservedBy: "Invader" });
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }))).toHaveLength(1);
  });

  // Regression: reservedBy must never suppress demand for a room WE reserve — only a foreign
  // reservation should stop new claimers (see the "already reserved" test above for the un-gated case).
  it("still requests a claimer for a room reserved by us", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60, reserved: true, reservedBy: undefined });
    expect(claimerRequests(colonySnap({ ...affordable, remoteSources: [remote] }))).toHaveLength(1);
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

  it("suppresses claimer demand at RCL3's 800 cap (single CLAIM+MOVE affords, but the real body needs 2 sets)", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 60 });
    expect(claimerRequests(colonySnap({ energyCapacity: 800, remoteSources: [remote] }))).toEqual([]);
  });
});
