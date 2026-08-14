// pickColonizeSponsor picks the nearest reachable, affordable colony to sponsor a colonize attempt,
// gated on the empire's GCL room budget. Pure — roomDistance and gclLevel are both injected (see
// fixtures' name-parsed Chebyshev stub), no Game involved.

import { describe, expect, it } from "vitest";
import { pickColonizeSponsor } from "../../../src/empire/colonizeSponsor";
import { COLONIZER_COST } from "../../../src/behaviors/roles/colonizer";
import { testColony, roomDistance, snapCreep } from "../../fixtures";

// High enough that none of the non-GCL tests below ever trip the room-budget gate incidentally.
const ROOMY_GCL = 10;

const pick = (colonies: Parameters<typeof pickColonizeSponsor>[0], target: string, dist = roomDistance, gcl = ROOMY_GCL) =>
  pickColonizeSponsor(colonies, target, dist, gcl);

describe("pickColonizeSponsor", () => {
  it("reports 'no colonies' when the empire is empty", () => {
    expect(pick([], "W5N5")).toEqual({ reason: "no colonies" });
  });

  it("picks the only affordable colony", () => {
    const home = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST });
    const result = pick([home], "W1N2");
    expect(result.colony?.name).toBe("W1N1");
  });

  it("picks the nearer of two affordable colonies", () => {
    const near = testColony({ name: "W3N3", energyCapacity: COLONIZER_COST });
    const far = testColony({ name: "W9N9", energyCapacity: COLONIZER_COST });
    const result = pick([far, near], "W3N4");
    expect(result.colony?.name).toBe("W3N3");
  });

  it("skips a colony that can't afford a colonizer body", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST - 1 });
    const rich = testColony({ name: "W9N9", energyCapacity: COLONIZER_COST });
    const result = pick([poor, rich], "W1N1");
    expect(result.colony?.name).toBe("W9N9");
  });

  it("reports 'unaffordable' when no colony can afford it", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST - 1 });
    expect(pick([poor], "W1N2")).toEqual({ reason: "unaffordable" });
  });

  it("reports 'unreachable' when every affordable colony is unroutable", () => {
    const stranded = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST });
    const unreachable = () => Infinity;
    const result = pick([stranded], "W9N9", unreachable);
    expect(result).toEqual({ reason: "unreachable" });
  });

  it("breaks distance ties by name for determinism", () => {
    const b = testColony({ name: "W2N2", energyCapacity: COLONIZER_COST });
    const a = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST });
    const tied = () => 5;
    const result = pick([b, a], "W5N5", tied);
    expect(result.colony?.name).toBe("W1N1");
  });
});

describe("pickColonizeSponsor GCL room budget", () => {
  it("blocks colonizing once owned colonies already meet GCL", () => {
    const home = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST });
    // GCL 1 with 1 owned colony already — no room left to claim another.
    expect(pick([home], "W2N2", roomDistance, 1)).toEqual({ reason: "gclLimitReached" });
  });

  it("allows colonizing while owned colonies are still under GCL", () => {
    const home = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST });
    const result = pick([home], "W2N2", roomDistance, 2);
    expect(result.colony?.name).toBe("W1N1");
  });

  it("counts an in-flight colonizer against the budget, not just owned colonies", () => {
    const home = testColony({
      name: "W1N1",
      energyCapacity: COLONIZER_COST,
      creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W3N3" } })]
    });
    // GCL 2: 1 owned colony + 1 in-flight colonizer already claims both slots.
    expect(pick([home], "W2N2", roomDistance, 2)).toEqual({ reason: "gclLimitReached" });
  });

  it("checks GCL before affordability, so the room-budget reason wins when both would fail", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: COLONIZER_COST - 1 });
    expect(pick([poor], "W2N2", roomDistance, 1)).toEqual({ reason: "gclLimitReached" });
  });
});
