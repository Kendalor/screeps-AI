// DrainHealer's step list: heal squad-mates (find:"squadMate", prefer:"mostDamaged" — the new heal
// verb and target find-variant from issue #35). ADR 0006's 200+ effective heal floor is a SQUAD total
// (3 healers together, see drain.ts's advanceIsSafe/incomingHeal) — each healer's body clears a third of
// that on its own (6 HEAL = 72 effective, x3 healers = 216), not 200+ individually.

import { describe, expect, it } from "vitest";
import { runStep } from "../../../src/behaviors/interpreter";
import { DrainHealer } from "../../../src/behaviors/roles/drainHealer";
import { clearTiles } from "../../constants";
import { stubGame } from "../../helpers";

describe("DrainHealer body", () => {
  it("3 healers together clear 200+ effective heal output (HEAL_POWER=12/part)", () => {
    const HEAL_POWER = 12;
    const HEALERS_IN_SQUAD = 3;
    const body = DrainHealer.body(10000, { hasContainer: false, hasLink: false });
    const healParts = body.filter(p => p === HEAL).length;
    expect(healParts * HEAL_POWER * HEALERS_IN_SQUAD).toBeGreaterThanOrEqual(200);
  });

  it("body is only TOUGH, HEAL and MOVE parts", () => {
    const body = DrainHealer.body(10000, { hasContainer: false, hasLink: false });
    expect(body.every(p => p === TOUGH || p === HEAL || p === MOVE)).toBe(true);
  });

  it("adds a fixed TOUGH buffer at max affordable size, none at the minimum floor", () => {
    const minBody = DrainHealer.body(1800, { hasContainer: false, hasLink: false });
    const maxBody = DrainHealer.body(10000, { hasContainer: false, hasLink: false });
    expect(minBody.filter(p => p === TOUGH).length).toBe(0);
    expect(maxBody.filter(p => p === TOUGH).length).toBe(4);
  });
});

describe("DrainHealer steps", () => {
  it("heals the most damaged squad-mate", () => {
    const fx = 20;
    const fy = 20;
    const healed: string[] = [];
    clearTiles();
    stubGame({ objects: {} });
    const mate = {
      id: "mate1",
      pos: { x: 21, y: 20 },
      hits: 100,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainAttacker" }
    };
    const creep = {
      id: "healer1",
      hits: 500,
      hitsMax: 500,
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      memory: { op: "drain:W1N1" },
      heal: (t: { id: string }) => healed.push(t.id),
      rangedHeal: () => undefined,
      travelTo: () => undefined
    };
    (creep as unknown as { room: { find: () => object[] } }).room = { find: () => [mate, creep] };
    // steps[0] is moveToPos (squad formation positioning, issue #37); heal is steps[1].
    const result = runStep(creep as unknown as Creep, DrainHealer.steps[1]);
    expect(healed).toEqual(["mate1"]);
    expect(result).toEqual({ acted: true, didAct: true, target: "mate1" });
  });
});
