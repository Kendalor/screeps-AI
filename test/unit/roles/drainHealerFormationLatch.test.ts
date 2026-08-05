// Regression for the original stuck-formation bug (live shard0, 2026-08-05): a drain healer that happened
// to be exactly at its formation slot fell through same-tick into `heal`, which resolved an out-of-range
// squadmate and travelled toward IT — grabbing primary-step status permanently, so the healer chased the
// heal target instead of its formation slot forever. The old fix was Step.standStill refereeing a
// step-table move/action race.
//
// Under ADR 0007 that race cannot occur BY CONSTRUCTION: a squadded healer's movement is dictated by
// planSquadMove (a pure function over the squad's shared state), and its heal action by planSquadActions —
// two independent outputs. The healer's destination is NEVER derived from which squadmate is most damaged;
// they are computed from entirely separate inputs. So the guarantee the old standStill flag protected now
// holds inherently, and we assert it at the primary pure seam rather than through a Game-mocked step race:
// no matter how damaged/close/far a heal target is, planSquadMove's per-member destination is unchanged.

import { describe, expect, it } from "vitest";
import { planSquadActions, planSquadMove, type SquadState } from "../../../src/lib/squad";
import { planDrainActions, DRAIN_FORMATION } from "../../../src/operations/drain";
import { colonySnap, snapCreep } from "../../fixtures";

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}
const terrain = (room: string) => (room === "W2N1" ? openTerrain() : undefined);

// A tight 2x2 drain squad standing at anchor (25,25) in W2N1, facing TOP.
function tightSquad(healerHits: number[] = [500, 500, 500]): SquadState {
  const room = "W2N1";
  const attacker = snapCreep("drainAttacker", { room, x: 25, y: 25, hits: 500, hitsMax: 500, memory: { op: "drain:W1N1" } });
  const healers = [
    { x: 26, y: 25 },
    { x: 25, y: 26 },
    { x: 26, y: 26 }
  ].map((p, i) =>
    snapCreep("drainHealer", { room, x: p.x, y: p.y, hits: healerHits[i], hitsMax: 500, memory: { op: "drain:W1N1" } })
  );
  return { members: [attacker, ...healers], formation: DRAIN_FORMATION, anchor: { x: 25, y: 25, room }, facing: TOP };
}

describe("DrainHealer formation latch regression (ADR 0007: movement is out of the step table)", () => {
  it("a squadded healer's movement is driven by planSquadMove, NOT by which squadmate needs healing", () => {
    // Two squads identical except for how damaged the members are: one fully healthy, one with a badly
    // wounded member. The heal-TARGET selection differs between them, but planSquadMove's per-member
    // MOVE destinations are byte-identical — movement never depends on heal-target resolution, the exact
    // coupling the old step-table race created and standStill patched.
    const goal = { x: 25, y: 20, room: "W2N1" };
    const healthy = tightSquad([500, 500, 500]);
    const wounded = tightSquad([500, 10, 500]); // second healer nearly dead

    const healthyMoves = planSquadMove(healthy, goal, terrain);
    const woundedMoves = planSquadMove(wounded, goal, terrain);

    // Same member order and ids in both fixtures — compare each member's destination tile.
    for (let i = 0; i < healthy.members.length; i++) {
      const h = healthyMoves.find(m => m.creep === healthy.members[i].id)!;
      const w = woundedMoves.find(m => m.creep === wounded.members[i].id)!;
      expect({ x: h.to.x, y: h.to.y }).toEqual({ x: w.to.x, y: w.to.y });
    }
  });

  it("heal targeting still resolves the most-damaged squadmate (the action, separate from movement)", () => {
    // The action planner picks the most damaged member to heal — this is real, useful targeting; it just
    // no longer has any way to hijack movement, because it is a wholly separate output.
    const wounded = tightSquad([500, 10, 500]);
    const colony = colonySnap({ name: "W1N1", draining: "W2N1" });
    const actions = planSquadActions(wounded, colony, planDrainActions);
    // Every healer's heal action points at the most-damaged member (the second healer, hits 10).
    const mostDamaged = wounded.members[2].id; // members[0]=attacker, [1]=healer 500, [2]=healer 10
    for (const member of wounded.members.filter(m => m.role === "drainHealer")) {
      expect(actions.get(member.id)).toEqual({ do: "heal", target: mostDamaged });
    }
  });

  it("an in-formation squad at its goal holds every member on its slot (heal never nudges it off)", () => {
    // The squad is a tight block already at the goal; planSquadMove assigns each member its own current
    // slot tile (zero movement), regardless of any heal target. No member is ever pulled toward a patient.
    const state = tightSquad([500, 10, 500]);
    const moves = planSquadMove(state, { x: 25, y: 25, room: "W2N1" }, terrain);
    for (const member of state.members) {
      const move = moves.find(m => m.creep === member.id)!;
      expect({ x: move.to.x, y: move.to.y }).toEqual({ x: member.x, y: member.y }); // stays on its own tile
    }
  });
});
