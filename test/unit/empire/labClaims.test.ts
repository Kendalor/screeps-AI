// Unit-proves the LabRunner allocation algorithm (docs/boosting-lab-runner-design.md section 3) as a pure
// function against plain fabricated stub data — same "plain fixture objects, no ColonySnapshot/live-Game
// needed" pattern test/unit/empire/logistics.test.ts already uses for this codebase's other pure empire
// planners. This function REPLACES the older per-creep planBoostLabAllocation (deleted, see design doc's
// "Why the previous shape was replaced" section) with a per-lab CLAIM shape instead.

import { describe, expect, it } from "vitest";
import { planLabClaims, type BoostContender, type LabClaim } from "../../../src/empire/labClaims";

const LAB_A = "labA" as Id<StructureLab>;
const LAB_B = "labB" as Id<StructureLab>;
const LAB_C = "labC" as Id<StructureLab>;

function contender(
  creepId: string,
  ticksUntilReady: number,
  needs: Partial<Record<ResourceConstant, number>>
): BoostContender {
  return { creepId: creepId as Id<Creep>, ticksUntilReady, needs };
}

describe("planLabClaims", () => {
  it("returns [] when there are no existing claims, no contenders, and no demand", () => {
    const result = planLabClaims([], [LAB_A, LAB_B, LAB_C], [], {});
    expect(result).toEqual([]);
  });

  it("grants a brand-new compound demand to a free lab when a contender needs it", () => {
    const contenders = [contender("a", 10, { LO: 400 })];
    const result = planLabClaims([], [LAB_A], contenders, { LO: 400 });

    expect(result).toEqual<LabClaim[]>([{ labId: LAB_A, compound: "LO", amount: 400 }]);
  });

  it("drops an existing claim whose compound demand is now 0, freeing the lab for phase B the same call", () => {
    const existing: LabClaim[] = [{ labId: LAB_A, compound: "LO", amount: 400 }];
    const contenders = [contender("b", 5, { GO: 300 })];
    // LO's demand collapsed to 0 (dropped); GO is brand-new demand that should claim the now-freed lab A.
    const result = planLabClaims(existing, [LAB_A], contenders, { LO: 0, GO: 300 });

    expect(result).toEqual<LabClaim[]>([{ labId: LAB_A, compound: "GO", amount: 300 }]);
  });

  it("carries forward an existing claim with its amount updated to the new aggregated demand figure", () => {
    const existing: LabClaim[] = [{ labId: LAB_A, compound: "LO", amount: 400 }];
    const result = planLabClaims(existing, [LAB_A], [], { LO: 250 });

    expect(result).toEqual<LabClaim[]>([{ labId: LAB_A, compound: "LO", amount: 250 }]);
  });

  it("gives the only free lab to the soonest-ready contender; the later one's compound gets nothing at all", () => {
    const contenders = [
      contender("b", 20, { GO: 300 }), // input order deliberately NOT sorted by readiness
      contender("a", 5, { LO: 400 })
    ];
    const result = planLabClaims([], [LAB_A], contenders, { LO: 400, GO: 300 });

    expect(result).toEqual<LabClaim[]>([{ labId: LAB_A, compound: "LO", amount: 400 }]);
    expect(result.some(c => c.compound === "GO")).toBe(false);
  });

  it("grants a single contender's multiple distinct compound needs separate labs when there's room", () => {
    const contenders = [contender("a", 5, { LO: 400, GO: 300 })];
    const result = planLabClaims([], [LAB_A, LAB_B], contenders, { LO: 400, GO: 300 });

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { labId: expect.any(String), compound: "LO", amount: 400 },
        { labId: expect.any(String), compound: "GO", amount: 300 }
      ])
    );
    // Distinct compounds must land on distinct labs.
    expect(result[0].labId).not.toBe(result[1].labId);
  });

  it("gives a single contender needing 2 compounds only ONE claim when only 1 free lab exists", () => {
    // Whichever of "needs"'s own two keys is iterated first wins the sole free lab — this is expected,
    // acceptable non-determinism SCOPED TO one creep's own need-ordering (not across contenders, which is
    // fully deterministic via ticksUntilReady). Object key iteration order for string keys follows insertion
    // order in JS, so LO (inserted first) is expected to win here.
    const contenders = [contender("a", 5, { LO: 400, GO: 300 })];
    const result = planLabClaims([], [LAB_A], contenders, { LO: 400, GO: 300 });

    expect(result).toHaveLength(1);
    expect(result[0].compound).toBe("LO");
    expect(result[0].amount).toBe(400);
  });

  it("creates only ONE claim for a compound two different contenders both need, sized to the aggregated amount", () => {
    const contenders = [contender("a", 5, { LO: 400 }), contender("b", 10, { LO: 400 })];
    const result = planLabClaims([], [LAB_A, LAB_B], contenders, { LO: 400 });

    expect(result).toEqual<LabClaim[]>([{ labId: LAB_A, compound: "LO", amount: 400 }]);
  });

  it("is pure: identical (deep-equal, not same-reference) inputs produce deep-equal outputs both times", () => {
    const existing: LabClaim[] = [{ labId: LAB_A, compound: "LO", amount: 400 }];
    const contenders = [contender("a", 5, { LO: 400, GO: 300 }), contender("b", 10, { UO: 100 })];
    const demand = { LO: 400, GO: 300, UO: 100 };

    const first = planLabClaims(existing, [LAB_A, LAB_B, LAB_C], contenders, demand);
    const second = planLabClaims(
      [{ labId: LAB_A, compound: "LO", amount: 400 }],
      [LAB_A, LAB_B, LAB_C],
      [contender("a", 5, { LO: 400, GO: 300 }), contender("b", 10, { UO: 100 })],
      { LO: 400, GO: 300, UO: 100 }
    );

    expect(first).toEqual(second);
  });

  it("never returns more claims than boostLabIds.length, however much demand/how many contenders exist", () => {
    const boostLabIds = [LAB_A, LAB_B]; // only 2 labs
    const contenders = [
      contender("a", 1, { LO: 100 }),
      contender("b", 2, { GO: 100 }),
      contender("c", 3, { UO: 100 }),
      contender("d", 4, { ZO: 100 })
    ];
    const demand = { LO: 100, GO: 100, UO: 100, ZO: 100 };

    const result = planLabClaims([], boostLabIds, contenders, demand);
    expect(result.length).toBeLessThanOrEqual(boostLabIds.length);
  });
});
