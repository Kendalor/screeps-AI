// Parade marches a player-sized squad ("2x2"/"3x3"/...) to wherever its flag currently sits, and keeps
// following as the flag moves — no combat, no staging room, no advance/retreat (unlike Drain). Constructed
// directly here (new Parade("W1N1")), same convention as Attack/Drain's tests: no Game mock, no Colony.

import { beforeEach, describe, expect, it } from "vitest";
import { Parade, paradeFormation } from "../../../src/operations/parade";
import { clearSquadMatrixCache } from "../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../constants";
import { colonySnap, snapCreep } from "../../fixtures";

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

const parade = new Parade("W1N1");

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

// A tight NxM block of paradeMember creeps at (25,25).., all sharing parade.name, in `room`.
function squad(shape: string, over: { room?: string; joined?: boolean } = {}) {
  const room = over.room ?? "W1N1";
  const formation = paradeFormation(shape)!;
  return formation.map(slot =>
    snapCreep("paradeMember", {
      room,
      x: 25 + slot.dx,
      y: 25 + slot.dy,
      memory: { op: parade.name, ...(over.joined ? { squadJoined: parade.name } : {}) }
    })
  );
}

describe("Parade.desiredCreeps", () => {
  it("requests exactly the formation's slot count when parading is set and nothing is owned yet", () => {
    const snap = colonySnap({ energyCapacity: 300, parading: { flag: "parade", formation: "2x2" } });
    const requests = parade.desiredCreeps(snap);
    expect(requests).toHaveLength(4);
    for (const r of requests) {
      expect(r.memory.role).toBe("paradeMember");
      expect(r.memory.op).toBe("parade:W1N1");
    }
  });

  it("requests 9 for a 3x3 formation", () => {
    const snap = colonySnap({ energyCapacity: 300, parading: { flag: "parade", formation: "3x3" } });
    expect(parade.desiredCreeps(snap)).toHaveLength(9);
  });

  it("falls back to the default shape for a non-square formation string", () => {
    const snap = colonySnap({ energyCapacity: 300, parading: { flag: "parade", formation: "1x3" } });
    expect(parade.desiredCreeps(snap)).toHaveLength(4); // DEFAULT_PARADE_FORMATION is "2x2"
  });

  it("requests nothing when parading is unset", () => {
    const snap = colonySnap({ energyCapacity: 300, parading: undefined });
    expect(parade.desiredCreeps(snap)).toEqual([]);
  });

  it("tops up only the missing members once some are already owned", () => {
    const snap = colonySnap({
      energyCapacity: 300,
      parading: { flag: "parade", formation: "2x2" },
      creeps: [
        snapCreep("paradeMember", { memory: { op: "parade:W1N1" } }),
        snapCreep("paradeMember", { memory: { op: "parade:W1N1" } })
      ]
    });
    expect(parade.desiredCreeps(snap)).toHaveLength(2);
  });

  it("requests nothing once the full formation is already owned", () => {
    const snap = colonySnap({
      energyCapacity: 300,
      parading: { flag: "parade", formation: "2x2" },
      creeps: squad("2x2")
    });
    expect(parade.desiredCreeps(snap)).toEqual([]);
  });

  it("falls back to the default 2x2 shape for a malformed formation string", () => {
    const snap = colonySnap({ energyCapacity: 300, parading: { flag: "parade", formation: "bogus" } });
    expect(parade.desiredCreeps(snap)).toHaveLength(4);
  });
});

describe("Parade.squadGoal", () => {
  it("is undefined when parading is unset", () => {
    const snap = colonySnap({ parading: undefined });
    expect(parade.squadGoal(snap)).toBeUndefined();
  });

  it("is undefined when the flag has been removed (paradeGoal absent)", () => {
    const snap = colonySnap({ parading: { flag: "parade", formation: "2x2" }, paradeGoal: undefined, creeps: squad("2x2") });
    expect(parade.squadGoal(snap)).toBeUndefined();
  });

  it("is undefined while no squad member exists yet", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: []
    });
    expect(parade.squadGoal(snap)).toBeUndefined();
  });

  it("is the flag's live position once a squad exists", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2")
    });
    expect(parade.squadGoal(snap)).toEqual({ x: 30, y: 30, room: "W1N1" });
  });
});

describe("Parade.squadState", () => {
  it("reports no squad while parading is unset", () => {
    const snap = colonySnap({ parading: undefined, creeps: squad("2x2") });
    expect(parade.squadState(snap)).toBeUndefined();
  });

  it("bootstraps membership: a freshly-assembled squad at home joins together immediately", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2")
    });
    const state = parade.squadState(snap);
    expect(state?.members).toHaveLength(4);
    expect(state?.formation).toHaveLength(4);
  });

  it("respects a 3x3 shape's member count", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "3x3" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("3x3")
    });
    const state = parade.squadState(snap);
    expect(state?.members).toHaveLength(9);
    expect(state?.formation).toHaveLength(9);
  });

  it("is undefined while no squad member exists", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: []
    });
    expect(parade.squadState(snap)).toBeUndefined();
  });

  it("reads the PERSISTED anchor once one is stored, ignoring the live members' own centroid", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2"),
      paradeAnchor: { x: 10, y: 10, room: "W1N1" }
    });
    const state = parade.squadState(snap);
    expect(state?.anchor).toEqual({ x: 10, y: 10, room: "W1N1" });
  });
});

describe("Parade.terrain / Parade.occupancy", () => {
  it("terrain reads paradeRoomTerrain by room name", () => {
    const snap = colonySnap({ paradeRoomTerrain: { W1N1: openTerrain() } });
    expect(parade.terrain(snap)("W1N1")).toBeDefined();
    expect(parade.terrain(snap)("W9N9")).toBeUndefined();
  });

  it("occupancy clears the squad's own tiles so it never blocks itself", () => {
    const mine = squad("2x2");
    const raw = new Uint8Array(2500);
    for (const c of mine) raw[c.x * 50 + c.y] = 1;
    raw[10 * 50 + 10] = 1; // an unrelated occupied tile, must survive the clear
    const snap = colonySnap({ creeps: mine, paradeRoomOccupancy: { W1N1: raw } });
    const grid = parade.occupancy(snap)("W1N1")!;
    for (const c of mine) expect(grid[c.x * 50 + c.y]).toBe(0);
    expect(grid[10 * 50 + 10]).toBe(1);
  });
});

describe("Parade.intents", () => {
  it("clears squadJoined off every member once parading is unset", () => {
    const snap = colonySnap({ parading: undefined, creeps: squad("2x2", { joined: true }) });
    const intents = parade.intents(snap);
    expect(intents.every(i => i.kind === "clearSquadJoined")).toBe(true);
    expect(intents).toHaveLength(4);
  });

  it("joins a freshly-assembled squad and never sets a rally pos for an already-squadded member", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2")
    });
    const intents = parade.intents(snap);
    const joins = intents.filter(i => i.kind === "setSquadJoined");
    expect(joins).toHaveLength(4);
    expect(intents.some(i => i.kind === "setParadeRallyPos")).toBe(false);
  });

  it("seeds ColonyMemory.paradeAnchor the tick a squad first exists with nothing persisted yet", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2")
    });
    const intents = parade.intents(snap);
    const setAnchor = intents.find(i => i.kind === "setParadeAnchor");
    expect(setAnchor).toBeDefined();
  });

  it("does NOT re-seed paradeAnchor once one is already persisted", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: squad("2x2"),
      paradeAnchor: { x: 10, y: 10, room: "W1N1" }
    });
    const intents = parade.intents(snap);
    expect(intents.some(i => i.kind === "setParadeAnchor")).toBe(false);
  });

  it("sets a rally pos toward the home room center for an unassembled squad", () => {
    const snap = colonySnap({
      parading: { flag: "parade", formation: "2x2" },
      paradeGoal: { x: 30, y: 30, room: "W1N1" },
      creeps: [snapCreep("paradeMember", { room: "W1N1", memory: { op: "parade:W1N1" } })]
    });
    const intents = parade.intents(snap);
    const rally = intents.find(i => i.kind === "setParadeRallyPos");
    expect(rally).toBeDefined();
    if (rally?.kind === "setParadeRallyPos") {
      expect(rally.pos).toEqual({ x: 25, y: 25, room: "W1N1" });
    }
  });
});
