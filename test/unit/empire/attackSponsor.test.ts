// pickAttackSponsor picks the nearest reachable, affordable colony to sponsor an attack. Pure —
// roomDistance is injected (see fixtures' name-parsed Chebyshev stub), no Game involved, and unlike
// pickColonizeSponsor there is no GCL room-budget gate (attacking claims nothing).

import { describe, expect, it } from "vitest";
import { pickAttackSponsor } from "../../../src/empire/attackSponsor";
import { ATTACKER_MIN_COST } from "../../../src/behaviors/roles/attacker";
import { testColony, roomDistance } from "../../fixtures";

const pick = (colonies: Parameters<typeof pickAttackSponsor>[0], target: string, dist = roomDistance) =>
  pickAttackSponsor(colonies, target, dist);

describe("pickAttackSponsor", () => {
  it("reports 'no colonies' when the empire is empty", () => {
    expect(pick([], "W5N5")).toEqual({ reason: "no colonies" });
  });

  it("picks the only affordable colony", () => {
    const home = testColony({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST });
    const result = pick([home], "W1N2");
    expect(result.colony?.name).toBe("W1N1");
  });

  it("picks the nearer of two affordable colonies", () => {
    const near = testColony({ name: "W3N3", energyCapacity: ATTACKER_MIN_COST });
    const far = testColony({ name: "W9N9", energyCapacity: ATTACKER_MIN_COST });
    const result = pick([far, near], "W3N4");
    expect(result.colony?.name).toBe("W3N3");
  });

  it("skips a colony that can't afford an attacker body", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST - 1 });
    const rich = testColony({ name: "W9N9", energyCapacity: ATTACKER_MIN_COST });
    const result = pick([poor, rich], "W1N1");
    expect(result.colony?.name).toBe("W9N9");
  });

  it("reports 'unaffordable' when no colony can afford it", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST - 1 });
    expect(pick([poor], "W1N2")).toEqual({ reason: "unaffordable" });
  });

  it("reports 'unreachable' when every affordable colony is unroutable", () => {
    const stranded = testColony({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST });
    const unreachable = () => Infinity;
    const result = pick([stranded], "W9N9", unreachable);
    expect(result).toEqual({ reason: "unreachable" });
  });

  it("breaks distance ties by name for determinism", () => {
    const b = testColony({ name: "W2N2", energyCapacity: ATTACKER_MIN_COST });
    const a = testColony({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST });
    const tied = () => 5;
    const result = pick([b, a], "W5N5", tied);
    expect(result.colony?.name).toBe("W1N1");
  });
});
