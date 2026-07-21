import { describe, expect, it } from "vitest";
import { nextStep, runStep, type CreepState } from "../../src/behaviors/interpreter";
import type { Step } from "../../src/behaviors/types";
import { stubGame } from "../helpers";

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

// --- runStep target reporting -------------------------------------------------
// runStep returns the id of the target it acted on so the dispatch can store it
// as the creep's lock for next tick (#23). undefined means "nothing to do" and
// is what drives CreepState.targetGone.

function siteCreep(over: Partial<{ built: object[]; range: boolean }> = {}): Creep {
  const acted: string[] = [];
  const creep = {
    actedOn: acted,
    pos: {
      x: 5,
      y: 5,
      findClosestByPath: (list: object[]) => list[0] ?? null,
      inRangeTo: () => over.range ?? true
    },
    room: { find: () => over.built ?? [] },
    build: (t: { id: string }) => acted.push(t.id),
    travelTo: () => undefined
  };
  return creep as unknown as Creep;
}

function site(id: string): object {
  return { id, pos: { x: 10, y: 10 }, progress: 0, progressTotal: 100 };
}

describe("runStep target reporting", () => {
  it("reports the id of the target it acted on", () => {
    const s = site("siteA");
    stubGame({ objects: { siteA: s } });

    expect(runStep(siteCreep({ built: [s] }), { do: "build" })).toEqual({ acted: true, target: "siteA" });
  });

  it("reports no action when no target resolves", () => {
    stubGame({ objects: {} });

    expect(runStep(siteCreep({ built: [] }), { do: "build" })).toEqual({ acted: false });
  });

  it("acts on the locked target rather than the nearest one", () => {
    const near = site("near");
    const locked = site("locked");
    stubGame({ objects: { near, locked } });
    const creep = siteCreep({ built: [near, locked] });

    // Without the lock findClosestByPath would return `near` (first in list).
    const used = runStep(creep, { do: "build" }, "locked" as Id<_HasId>);

    expect(used).toEqual({ acted: true, target: "locked" });
    expect((creep as unknown as { actedOn: string[] }).actedOn).toEqual(["locked"]);
  });
});
