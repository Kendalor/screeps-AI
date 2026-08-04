// pickDrainSponsor picks the nearest reachable, affordable colony to sponsor a drain squad. Pure —
// roomDistance is injected (see fixtures' name-parsed Chebyshev stub), no Game involved, and unlike
// pickColonizeSponsor there is no GCL room-budget gate (draining claims nothing). Mirrors
// attackSponsor.test.ts's structure exactly; the only behavioral difference is the affordability floor,
// which prices a full drain squad (1 attacker + 3 healers, ADR 0006) instead of a single attacker body.

import { describe, expect, it } from "vitest";
import { pickDrainSponsor } from "../../../src/empire/drainSponsor";
import { DRAIN_ATTACKER_MIN_COST } from "../../../src/behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../../../src/behaviors/roles/drainHealer";
import { testColony, roomDistance } from "../../fixtures";

const SQUAD_MIN_COST = DRAIN_ATTACKER_MIN_COST + 3 * DRAIN_HEALER_MIN_COST;

const pick = (colonies: Parameters<typeof pickDrainSponsor>[0], target: string, dist = roomDistance) =>
  pickDrainSponsor(colonies, target, dist);

describe("pickDrainSponsor", () => {
  it("reports 'no colonies' when the empire is empty", () => {
    expect(pick([], "W5N5")).toEqual({ reason: "no colonies" });
  });

  it("picks the only affordable colony", () => {
    const home = testColony({ name: "W1N1", energyCapacity: SQUAD_MIN_COST });
    const result = pick([home], "W1N2");
    expect(result.colony?.name).toBe("W1N1");
  });

  it("picks the nearer of two affordable colonies", () => {
    const near = testColony({ name: "W3N3", energyCapacity: SQUAD_MIN_COST });
    const far = testColony({ name: "W9N9", energyCapacity: SQUAD_MIN_COST });
    const result = pick([far, near], "W3N4");
    expect(result.colony?.name).toBe("W3N3");
  });

  it("skips a colony that can't afford a full drain squad", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: SQUAD_MIN_COST - 1 });
    const rich = testColony({ name: "W9N9", energyCapacity: SQUAD_MIN_COST });
    const result = pick([poor, rich], "W1N1");
    expect(result.colony?.name).toBe("W9N9");
  });

  it("reports 'unaffordable' when no colony can afford a full squad", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: SQUAD_MIN_COST - 1 });
    expect(pick([poor], "W1N2")).toEqual({ reason: "unaffordable" });
  });

  it("reports 'unreachable' when every affordable colony is unroutable", () => {
    const stranded = testColony({ name: "W1N1", energyCapacity: SQUAD_MIN_COST });
    const unreachable = () => Infinity;
    const result = pick([stranded], "W9N9", unreachable);
    expect(result).toEqual({ reason: "unreachable" });
  });

  it("breaks distance ties by name for determinism", () => {
    const b = testColony({ name: "W2N2", energyCapacity: SQUAD_MIN_COST });
    const a = testColony({ name: "W1N1", energyCapacity: SQUAD_MIN_COST });
    const tied = () => 5;
    const result = pick([b, a], "W5N5", tied);
    expect(result.colony?.name).toBe("W1N1");
  });
});
