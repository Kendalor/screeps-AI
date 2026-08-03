// scoutCandidatesAround walks Game.map.describeExits outward from a colony's room, so it's the one
// place in scouting that needs a live Game.map stub rather than a plain snapshot fixture.

import { describe, expect, it } from "vitest";
import { scoutCandidatesAround } from "../../src/snapshot/scoutGraph";
import { stubGame } from "../helpers";

function stubMap(exits: Record<string, Partial<Record<"1" | "3" | "5" | "7", string>>>): void {
  (globalThis as { Game: { map: unknown } }).Game.map = {
    describeExits: (room: string) => exits[room],
    getRoomStatus: () => ({ status: "normal" })
  };
}

describe("scoutCandidatesAround", () => {
  it("includes the origin itself at distance 0", () => {
    stubGame();
    stubMap({ W1N1: { "3": "W1N2" }, W1N2: { "7": "W1N1" } });

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out).toContainEqual(expect.objectContaining({ room: "W1N1", distance: 0 }));
  });

  it("carries the origin's own last-recorded observation, not a fresh one", () => {
    stubGame();
    stubMap({ W1N1: {} });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N1: { scouted: { tick: 42, type: "normal", sources: [], hostile: false } } }
    };

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.find(c => c.room === "W1N1")?.info).toEqual({ tick: 42, type: "normal", sources: [], hostile: false });
  });

  it("still walks neighbours outward alongside the origin entry", () => {
    stubGame();
    stubMap({ W1N1: { "3": "W1N2" }, W1N2: { "7": "W1N1" } });

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2"]);
  });

  it("distances a diagonal room by real room-graph hops, not Game.map.getRoomLinearDistance's Chebyshev shortcut", () => {
    // W1N1 -> W2N1 (east) -> W2N2 (south): a room only connects to its N/S/E/W neighbours, so W2N2 is 2
    // hops away even though its Chebyshev distance from W1N1 is 1 — the exact mispricing that let
    // pickRemotes prefer an unreachable-in-one-hop diagonal room over a true neighbour.
    stubGame();
    stubMap({
      W1N1: { "3": "W2N1" },
      W2N1: { "7": "W1N1", "5": "W2N2" },
      W2N2: { "1": "W2N1" }
    });

    const out = scoutCandidatesAround("W1N1", 2);

    expect(out.find(c => c.room === "W2N1")?.distance).toBe(1);
    expect(out.find(c => c.room === "W2N2")?.distance).toBe(2);
  });

  it("excludes rooms behind a closed/novice boundary, but still includes the origin", () => {
    stubGame();
    (globalThis as { Game: { map: unknown } }).Game.map = {
      describeExits: (room: string) => (room === "W1N1" ? { "3": "W1N2" } : undefined),
      getRoomStatus: (room: string) => ({ status: room === "W1N2" ? "closed" : "normal" })
    };

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.map(c => c.room)).toEqual(["W1N1"]);
  });

  it("includes a neighbour sharing the origin's own non-normal status (e.g. both inside a respawn zone)", () => {
    stubGame();
    (globalThis as { Game: { map: unknown } }).Game.map = {
      describeExits: (room: string) => (room === "W1N1" ? { "3": "W1N2" } : undefined),
      getRoomStatus: () => ({ status: "respawn" })
    };

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2"]);
  });

  it("stops expanding past a room proven unreachable from home, but still includes the room itself", () => {
    // W1N2 is walled solid at every border a scout could enter from — moveToRoom already recorded that
    // via noPathFrom. W1N3 sits beyond it and must not appear: nothing has ever proven a scout can reach
    // W1N2's own exits from here, so the frontier has no business claiming W1N3 needs scouting yet.
    stubGame();
    stubMap({ W1N1: { "3": "W1N2" }, W1N2: { "7": "W1N1", "3": "W1N3" }, W1N3: { "7": "W1N2" } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 1, type: "normal", sources: [], hostile: false, noPathFrom: { W1N1: Game.time } } } }
    };

    const out = scoutCandidatesAround("W1N1", 2, "W1N1");

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2"]);
  });

  it("still reaches a room through an unsealed second route, even though one parent to it is sealed", () => {
    // Diamond: W1N1 -> W1N2 -> W1N3 (sealed leg) and W1N1 -> W2N1 -> W1N3 (open leg). Per the user's
    // spec — "prune only if there is no other viable route" — W1N3 must survive because the W2N1 leg
    // still gets there; only a room with EVERY route sealed should ever be pruned.
    stubGame();
    stubMap({
      W1N1: { "3": "W1N2", "5": "W2N1" },
      W1N2: { "7": "W1N1", "3": "W1N3" },
      W2N1: { "7": "W1N1", "3": "W1N3" },
      W1N3: { "7": "W1N2", "5": "W2N1" }
    });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 1, type: "normal", sources: [], hostile: false, noPathFrom: { W1N1: Game.time } } } }
    };

    const out = scoutCandidatesAround("W1N1", 2, "W1N1");

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2", "W1N3", "W2N1"]);
  });

  it("does not apply the noPathFrom cut when no home is passed (non-scouting callers)", () => {
    stubGame();
    stubMap({ W1N1: { "3": "W1N2" }, W1N2: { "7": "W1N1", "3": "W1N3" }, W1N3: { "7": "W1N2" } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 1, type: "normal", sources: [], hostile: false, noPathFrom: { W1N1: Game.time } } } }
    };

    const out = scoutCandidatesAround("W1N1", 2);

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2", "W1N3"]);
  });

  it("resumes expanding past a room once its noPathFrom entry has aged out the retry window", () => {
    stubGame();
    stubMap({ W1N1: { "3": "W1N2" }, W1N2: { "7": "W1N1", "3": "W1N3" }, W1N3: { "7": "W1N2" } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 1, type: "normal", sources: [], hostile: false, noPathFrom: { W1N1: 0 } } } }
    };
    Game.time = 999999;

    const out = scoutCandidatesAround("W1N1", 2, "W1N1");

    expect(out.map(c => c.room).sort()).toEqual(["W1N1", "W1N2", "W1N3"]);
  });

  it("still excludes a neighbour whose status matches neither normal nor the origin's own", () => {
    stubGame();
    (globalThis as { Game: { map: unknown } }).Game.map = {
      describeExits: (room: string) => (room === "W1N1" ? { "3": "W1N2" } : undefined),
      getRoomStatus: (room: string) => ({ status: room === "W1N1" ? "respawn" : "novice" })
    };

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.map(c => c.room)).toEqual(["W1N1"]);
  });

  it("excludes a 'normal' neighbour reached directly from a still-active respawn/novice zone room", () => {
    // The World places a real (structure, not terrain) wall on the zone-exit border until the zone's
    // protection timestamp expires — a "normal"-status neighbour is not automatically enterable just
    // because its own status is normal; it must match the status of the room being exited FROM.
    // Regression case for scouts routing straight into that border wall and getting stuck.
    stubGame();
    (globalThis as { Game: { map: unknown } }).Game.map = {
      describeExits: (room: string) => (room === "W1N1" ? { "3": "W1N2" } : undefined),
      getRoomStatus: (room: string) => ({ status: room === "W1N1" ? "respawn" : "normal" })
    };

    const out = scoutCandidatesAround("W1N1", 1);

    expect(out.map(c => c.room)).toEqual(["W1N1"]);
  });

});
