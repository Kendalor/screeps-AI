import { describe, expect, it } from "vitest";
import { neighborhoodFullyScouted, summarizePotential } from "../../../src/mining/summarizeNeighborhoodPotential";
import { remotePotential } from "../../../src/mining/remotePotentialTable";
import { keeperPotential } from "../../../src/mining/keeperPotentialTable";
import { scouted } from "../../fixtures";
import type { ScoutCandidate } from "../../../src/snapshot/types";

function candidate(room: string, distance: number, over: Parameters<typeof scouted>[0] = {}): ScoutCandidate {
  return { room, distance, type: over.type ?? "normal", info: scouted(over) };
}

describe("neighborhoodFullyScouted", () => {
  it("is true when every non-self candidate has an info record", () => {
    const candidates = [candidate("W1N1", 0), candidate("W1N2", 1), candidate("W1N3", 2)];
    expect(neighborhoodFullyScouted(candidates)).toBe(true);
  });

  it("ignores distance-0 (the candidate room itself) even with no info", () => {
    const candidates: ScoutCandidate[] = [
      { room: "W1N1", distance: 0, type: "normal", info: undefined },
      candidate("W1N2", 1)
    ];
    expect(neighborhoodFullyScouted(candidates)).toBe(true);
  });

  it("is false when any non-self neighbor is unscouted", () => {
    const candidates: ScoutCandidate[] = [candidate("W1N1", 0), { room: "W1N2", distance: 1, type: "normal", info: undefined }];
    expect(neighborhoodFullyScouted(candidates)).toBe(false);
  });
});

describe("summarizePotential", () => {
  it("sums remotePotential across unowned normal-room neighbors", () => {
    const candidates = [
      candidate("W1N1", 0), // the candidate room itself — excluded
      candidate("W1N2", 1, { sources: [{ id: "s1" as Id<Source>, x: 10, y: 10 }, { id: "s2" as Id<Source>, x: 20, y: 20 }] }),
      candidate("W1N3", 2, { sources: [{ id: "s3" as Id<Source>, x: 10, y: 10 }] })
    ];
    const result = summarizePotential(candidates);
    expect(result.normal).toBeCloseTo(remotePotential(2, 1) + remotePotential(1, 2), 5);
    expect(result.keeper).toBe(0);
  });

  it("sums keeperPotential across keeper-room neighbors, separately from normal", () => {
    const candidates = [
      candidate("W1N1", 0),
      candidate("W1N2", 1, { type: "keeper", mineral: "X" as MineralConstant })
    ];
    const result = summarizePotential(candidates);
    expect(result.normal).toBe(0);
    expect(result.keeper).toBeCloseTo(keeperPotential(1), 5);
    expect(result.keeperMinerals).toEqual(["X"]);
  });

  it("excludes an owned neighbor", () => {
    const candidates = [candidate("W1N1", 0), candidate("W1N2", 1, { owner: "someoneElse" })];
    expect(summarizePotential(candidates).normal).toBe(0);
  });

  it("excludes a hostile neighbor", () => {
    const candidates = [candidate("W1N1", 0), candidate("W1N2", 1, { hostile: true })];
    expect(summarizePotential(candidates).normal).toBe(0);
  });

  it("excludes an unscouted neighbor (no info) instead of throwing", () => {
    const candidates: ScoutCandidate[] = [candidate("W1N1", 0), { room: "W1N2", distance: 1, type: "normal", info: undefined }];
    expect(summarizePotential(candidates).normal).toBe(0);
  });

  it("excludes a neighbor past MAX_REMOTE_HOPS", () => {
    const candidates = [candidate("W1N1", 0), candidate("W1N5", 4, { sources: [{ id: "s1" as Id<Source>, x: 10, y: 10 }] })];
    expect(summarizePotential(candidates).normal).toBe(0);
  });

  it("excludes highway neighbors (no sources, not normal or keeper)", () => {
    const candidates = [candidate("W1N1", 0), candidate("W10N10", 1, { type: "highway", sources: [] })];
    expect(summarizePotential(candidates).normal).toBe(0);
    expect(summarizePotential(candidates).keeper).toBe(0);
  });

  it("deduplicates keeper minerals across multiple keeper neighbors sharing the same mineral", () => {
    const candidates = [
      candidate("W1N1", 0),
      candidate("W1N2", 1, { type: "keeper", mineral: "X" as MineralConstant }),
      candidate("W1N3", 2, { type: "keeper", mineral: "X" as MineralConstant })
    ];
    expect(summarizePotential(candidates).keeperMinerals).toEqual(["X"]);
  });
});
