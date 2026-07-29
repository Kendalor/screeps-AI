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
});
