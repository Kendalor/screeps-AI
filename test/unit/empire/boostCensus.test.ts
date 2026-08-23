import { describe, expect, it } from "vitest";
import { boostedRequestsInCensus } from "../../../src/empire/boostCensus";
import type { CreepRequest } from "../../../src/spawn/request";

// Minimal fabricated CreepRequest — only the fields boostedRequestsInCensus actually reads
// (memory.boosts) matter; the rest are filled with plausible placeholder values matching the
// real CreepRequest shape (src/spawn/request.ts) so the fixture stays representative.
function fakeRequest(boosts?: string[]): CreepRequest {
  return {
    body: [],
    priority: 1,
    memory: {
      role: "hauler",
      home: "W1N1",
      ...(boosts ? { boosts } : {})
    } as CreepRequest["memory"],
    targetRoom: "W1N1"
  };
}

describe("boostedRequestsInCensus", () => {
  it("returns the requests carrying a non-empty boosts array when present", () => {
    const boosted = fakeRequest(["heal", "tough"]);
    const plain = fakeRequest();
    const census = [plain, boosted];

    expect(boostedRequestsInCensus(census)).toEqual([boosted]);
  });

  it("returns an empty array when no request in the census carries a boost order", () => {
    const census = [fakeRequest(), fakeRequest(undefined), fakeRequest([])];

    expect(boostedRequestsInCensus(census)).toEqual([]);
  });

  it("returns an empty array for an empty census without error", () => {
    expect(boostedRequestsInCensus([])).toEqual([]);
  });
});
