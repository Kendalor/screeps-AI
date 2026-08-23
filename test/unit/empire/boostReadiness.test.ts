import { describe, expect, it } from "vitest";
import { readinessScore, resolveScarcity, type BoostOrderNeed, type LabState, type ReadinessEntry } from "../../../src/empire/boostReadiness";

describe("readinessScore", () => {
  it("counts needed compounds that already have a lab stocked with enough of that compound", () => {
    const needs: BoostOrderNeed[] = [
      { compound: "UH", amount: 30 },
      { compound: "UH2O", amount: 30 },
    ];
    const labs: LabState[] = [
      { labId: "lab1", resource: "UH", amount: 30 },
      { labId: "lab2", resource: "XUH2O", amount: 100 }, // wrong compound, doesn't count
    ];

    expect(readinessScore(needs, labs)).toBe(1);
  });

  it("does not count a lab stocked with the right compound but too little of it", () => {
    const needs: BoostOrderNeed[] = [{ compound: "UH", amount: 30 }];
    const labs: LabState[] = [{ labId: "lab1", resource: "UH", amount: 10 }];

    expect(readinessScore(needs, labs)).toBe(0);
  });

  it("scores 0 when no labs are stocked at all", () => {
    const needs: BoostOrderNeed[] = [{ compound: "UH", amount: 30 }];
    const labs: LabState[] = [{ labId: "lab1", amount: 0 }];

    expect(readinessScore(needs, labs)).toBe(0);
  });

  it("counts every satisfied need once, even with extra unrelated stocked labs", () => {
    const needs: BoostOrderNeed[] = [
      { compound: "UH", amount: 30 },
      { compound: "UO", amount: 30 },
      { compound: "KO", amount: 30 },
    ];
    const labs: LabState[] = [
      { labId: "lab1", resource: "UH", amount: 30 },
      { labId: "lab2", resource: "UO", amount: 30 },
      { labId: "lab3", resource: "GH", amount: 30 }, // not needed
    ];

    expect(readinessScore(needs, labs)).toBe(2);
  });

  it("a creep with more needed labs already ready scores higher than one with fewer, all else equal", () => {
    const needs: BoostOrderNeed[] = [
      { compound: "UH", amount: 30 },
      { compound: "UO", amount: 30 },
      { compound: "KO", amount: 30 },
    ];
    const mostlyReadyLabs: LabState[] = [
      { labId: "lab1", resource: "UH", amount: 30 },
      { labId: "lab2", resource: "UO", amount: 30 },
      { labId: "lab3", amount: 0 },
    ];
    const barelyReadyLabs: LabState[] = [
      { labId: "lab1", resource: "UH", amount: 30 },
      { labId: "lab2", amount: 0 },
      { labId: "lab3", amount: 0 },
    ];

    const higher = readinessScore(needs, mostlyReadyLabs);
    const lower = readinessScore(needs, barelyReadyLabs);
    expect(higher).toBeGreaterThan(lower);
  });

  it("counts a compound needed only once even if multiple labs stock it", () => {
    const needs: BoostOrderNeed[] = [{ compound: "UH", amount: 30 }];
    const labs: LabState[] = [
      { labId: "lab1", resource: "UH", amount: 30 },
      { labId: "lab2", resource: "UH", amount: 30 },
    ];

    expect(readinessScore(needs, labs)).toBe(1);
  });
});

describe("resolveScarcity", () => {
  it("picks the creep with the highest readiness score when there are fewer free labs than requests", () => {
    const entries: ReadinessEntry[] = [
      { creepId: "creepA", score: 1 },
      { creepId: "creepB", score: 3 },
      { creepId: "creepC", score: 2 },
    ];

    const winners = resolveScarcity(entries, 1);
    expect(winners).toHaveLength(1);
    expect(winners[0].creepId).toBe("creepB");
  });

  it("returns the top N entries sorted by score descending when freeLabs allows more than one winner", () => {
    const entries: ReadinessEntry[] = [
      { creepId: "creepA", score: 1 },
      { creepId: "creepB", score: 3 },
      { creepId: "creepC", score: 2 },
    ];

    const winners = resolveScarcity(entries, 2);
    expect(winners.map(e => e.creepId)).toEqual(["creepB", "creepC"]);
  });

  it("returns every entry, still sorted, when freeLabs is at least the number of requests", () => {
    const entries: ReadinessEntry[] = [
      { creepId: "creepA", score: 1 },
      { creepId: "creepB", score: 3 },
    ];

    const winners = resolveScarcity(entries, 5);
    expect(winners.map(e => e.creepId)).toEqual(["creepB", "creepA"]);
  });

  it("returns nothing when there are no free labs", () => {
    const entries: ReadinessEntry[] = [{ creepId: "creepA", score: 1 }];

    expect(resolveScarcity(entries, 0)).toEqual([]);
  });

  // Tiebreaker: lexicographic ascending order of creepId, chosen for the same reason
  // matchEmpireRequests (empire/logistics.ts) breaks ties deterministically rather than leaving them to
  // sort-stability accidents — a tie must resolve the SAME way every tick regardless of the entries'
  // input order, or the winner could flicker tick-to-tick with no underlying state change. Lexicographic
  // order needs no extra input (unlike, say, "oldest boost order first", which would need a timestamp this
  // module doesn't have) and is trivially reproducible in a test.
  it("breaks a tie in readiness score deterministically by lexicographic creepId order", () => {
    const entries: ReadinessEntry[] = [
      { creepId: "creepZ", score: 2 },
      { creepId: "creepA", score: 2 },
      { creepId: "creepM", score: 2 },
    ];

    const winners = resolveScarcity(entries, 2);
    expect(winners.map(e => e.creepId)).toEqual(["creepA", "creepM"]);
  });

  it("keeps the tie ordering stable no matter the input order", () => {
    const entries: ReadinessEntry[] = [
      { creepId: "creepM", score: 2 },
      { creepId: "creepZ", score: 2 },
      { creepId: "creepA", score: 2 },
    ];

    const winners = resolveScarcity(entries, 1);
    expect(winners.map(e => e.creepId)).toEqual(["creepA"]);
  });
});
