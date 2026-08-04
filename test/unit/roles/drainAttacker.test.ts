// DrainAttacker's step list: target STRUCTURE_TOWER first, falling back to prefer:"mostThreatening"
// hostile-creep ranking when no tower is in range. Exercises the role's real Step[] through runStep,
// same shape as interpreter.test.ts's "attack step" block, mirroring its stub-creep style.

import { describe, expect, it } from "vitest";
import { runStep } from "../../../src/behaviors/interpreter";
import { DrainAttacker } from "../../../src/behaviors/roles/drainAttacker";
import { clearTiles } from "../../constants";
import { stubGame } from "../../helpers";

function fighter(over: { tower?: object; hostiles?: object[]; fx?: number; fy?: number }) {
  const fx = over.fx ?? 20;
  const fy = over.fy ?? 20;
  const attacked: string[] = [];
  const traveled: { x: number; y: number }[] = [];
  clearTiles();
  stubGame({ objects: {} });
  const room = {
    find: (kind: number) => {
      // FIND_STRUCTURES vs FIND_HOSTILE_CREEPS — the test constants module assigns these numeric IDs.
      if (kind === FIND_STRUCTURES) return over.tower ? [over.tower] : [];
      if (kind === FIND_HOSTILE_CREEPS) return over.hostiles ?? [];
      return [];
    }
  };
  const creep = {
    pos: {
      x: fx,
      y: fy,
      roomName: "W1N1",
      inRangeTo: (pos: { x: number; y: number }, range: number) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)) <= range,
      getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room,
    getActiveBodyparts: () => 0, // no RANGED_ATTACK — DrainAttacker is pure melee (ATTACK:MOVE)
    attack: (t: { id: string }) => attacked.push(t.id),
    travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
  };
  return { creep: creep as unknown as Creep, attacked, traveled };
}

describe("DrainAttacker steps", () => {
  it("attacks a tower over a hostile creep when both are in range", () => {
    const tower = { id: "tower1", structureType: STRUCTURE_TOWER, pos: { x: 21, y: 20 } };
    const hostile = {
      id: "hostile1",
      pos: { x: 20, y: 21 },
      getActiveBodyparts: (part: BodyPartConstant) => (part === ATTACK ? 1 : 0)
    };
    const { creep, attacked } = fighter({ tower, hostiles: [hostile] });
    const result = runStep(creep, DrainAttacker.steps[2]);
    expect(attacked).toEqual(["tower1"]);
    expect(result).toEqual({ acted: true, didAct: true, target: "tower1" });
  });

  it("falls back to mostThreatening hostile when no tower is in range", () => {
    const armed = {
      id: "armed1",
      pos: { x: 21, y: 20 },
      getActiveBodyparts: (part: BodyPartConstant) => (part === ATTACK ? 1 : 0)
    };
    const unarmed = {
      id: "unarmed1",
      pos: { x: 20, y: 21 },
      getActiveBodyparts: () => 0
    };
    // Tower step (index 2) resolves nothing — no tower present at all.
    const { creep, attacked } = fighter({ hostiles: [unarmed, armed] });
    const towerResult = runStep(creep, DrainAttacker.steps[2]);
    expect(towerResult).toEqual({ acted: false, didAct: false });

    const hostileResult = runStep(creep, DrainAttacker.steps[3]);
    expect(attacked).toEqual(["armed1"]); // mostThreatening: armed beats unarmed
    expect(hostileResult).toEqual({ acted: true, didAct: true, target: "armed1" });
  });
});
