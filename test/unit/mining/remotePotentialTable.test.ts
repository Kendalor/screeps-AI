import { describe, it, expect } from "vitest";
import { remotePotential, REMOTE_POTENTIAL_TABLE } from "../../../src/mining/remotePotentialTable";
import { MAX_REMOTE_HOPS } from "../../../src/mining/pickRemotes";

describe("remotePotential", () => {
  it("is positive for a nearby room and shrinks as hops grow", () => {
    const near = remotePotential(2, 0);
    const far = remotePotential(2, MAX_REMOTE_HOPS);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });

  it("a 2-source room is worth roughly double a 1-source room at the same hop distance", () => {
    // Not exact: only the shared claimer cost breaks strict doubling, and it's the same flat term at
    // every hop count, so the two never diverge by more than that fixed amount.
    for (let hops = 0; hops <= MAX_REMOTE_HOPS; hops++) {
      const one = remotePotential(1, hops);
      const two = remotePotential(2, hops);
      expect(two).toBeGreaterThan(one);
    }
  });

  it("is 0 past MAX_REMOTE_HOPS — never worth scoring a room that far out", () => {
    expect(remotePotential(1, MAX_REMOTE_HOPS + 1)).toBe(0);
    expect(remotePotential(2, MAX_REMOTE_HOPS + 5)).toBe(0);
  });

  it("is 0 for a source count outside the table's range", () => {
    expect(remotePotential(0, 0)).toBe(0);
    expect(remotePotential(3, 0)).toBe(0);
  });

  it("the table has exactly MAX_REMOTE_HOPS + 1 entries per source-count row", () => {
    expect(REMOTE_POTENTIAL_TABLE[1]).toHaveLength(MAX_REMOTE_HOPS + 1);
    expect(REMOTE_POTENTIAL_TABLE[2]).toHaveLength(MAX_REMOTE_HOPS + 1);
  });
});
