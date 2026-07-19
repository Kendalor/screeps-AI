import { describe, expect, it } from "vitest";
import { nextStep, type CreepState } from "../../src/behaviors/interpreter";
import type { Step } from "../../src/behaviors/types";

// A three-step loop: gather from a source, then spend on spawn, then upgrade.
const STEPS: Step[] = [
  { do: "harvest", from: { find: "source" } },
  { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
  { do: "upgrade" }
];

function state(over: Partial<CreepState> = {}): CreepState {
  return { step: 0, free: 50, used: 0, targetGone: false, ...over };
}

describe("interpreter step advancement", () => {
  it("stays on a gathering step while the creep still has free capacity", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 50, used: 0 }))).toBe(0);
  });

  it("advances off a gathering step once the store is full", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 0, used: 50 }))).toBe(1);
  });

  it("stays on a spending step while the creep still carries resources", () => {
    expect(nextStep(STEPS, state({ step: 1, free: 25, used: 25 }))).toBe(1);
  });

  it("advances off a spending step once the store is empty", () => {
    expect(nextStep(STEPS, state({ step: 1, free: 50, used: 0 }))).toBe(2);
  });

  it("wraps from the last step back to the first", () => {
    // upgrade is a spending step; empty store completes it and loops around
    expect(nextStep(STEPS, state({ step: 2, free: 50, used: 0 }))).toBe(0);
  });

  it("advances immediately when the locked target has vanished", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 50, used: 0, targetGone: true }))).toBe(1);
  });
});
