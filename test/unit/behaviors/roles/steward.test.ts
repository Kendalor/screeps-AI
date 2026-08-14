import { describe, expect, it } from "vitest";
import { stewardBody } from "../../../../src/behaviors/roles/steward";
import { bodyCost, countPart } from "../../../../src/spawn/body";

describe("stewardBody", () => {
  // The largest single job a steward ever does is draining a full link (800 capacity) — capping CARRY
  // there avoids spawning dead capacity a stationary, zero-travel creep never uses.
  it("caps CARRY at 16 parts (800 capacity) regardless of how much energy is available", () => {
    const body = stewardBody(2500); // enough for the full 50-part hard cap if uncapped
    expect(countPart(body, CARRY)).toBe(16);
    expect(countPart(body, MOVE)).toBe(1);
    expect(body).toHaveLength(17);
  });

  it("still caps at high but sub-maximal energy", () => {
    expect(countPart(stewardBody(1800), CARRY)).toBe(16);
  });

  it("scales down below the cap so it never costs more than what's affordable", () => {
    const body = stewardBody(300); // one MOVE (50) + up to 5 CARRY (250) = 300
    expect(countPart(body, MOVE)).toBe(1);
    expect(countPart(body, CARRY)).toBe(5);
    expect(bodyCost(body)).toBeLessThanOrEqual(300);
  });

  it("never returns fewer than one CARRY even at minimal energy", () => {
    const body = stewardBody(100);
    expect(countPart(body, CARRY)).toBeGreaterThanOrEqual(1);
  });
});
