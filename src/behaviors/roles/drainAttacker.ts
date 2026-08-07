import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// ATTACK:MOVE 1:1 — no TOUGH, unlike Attacker: this squad member is protected by the drain squad's
// healers (see ADR 0006), so it doesn't need to soak its own hits the way a standalone striker does.
// 1 MOVE per ATTACK keeps it at full speed on plain terrain (screeps' road-free speed-1 ratio) even
// fully loaded. Scales up to the same 5-set ceiling Attacker uses as a ballpark for a single striker.
const DRAIN_ATTACKER_SET: BodyPartConstant[] = [ATTACK, MOVE];
const MAX_DRAIN_ATTACKER_SETS = 5;

export const DRAIN_ATTACKER_MIN_COST = bodyCost(DRAIN_ATTACKER_SET);

function drainAttackerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, DRAIN_ATTACKER_SET, 1, MAX_DRAIN_ATTACKER_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...DRAIN_ATTACKER_SET);
  return body;
}

// The Drain Energy operation's (issue #34/ADR 0006) melee squad member: prioritizes towers (the source of
// the operation's namesake energy drain) over any hostile creep, falling back to the most threatening
// hostile once no tower remains in range.
//
// This step table is used ONLY while the creep is NOT currently squadded (ADR 0007): before the squad has
// assembled, while a freshly-spawned replacement is still walking toward the squad, or after the operation
// dissolves. Once squadded, movement AND action are dictated by the Squad entity (empire/creeps.ts's
// runSquads calls planSquadMove/planSquadActions), never this step table — so there's no moveToPos/action
// race to referee here, and no standStill needed (both were removed with the step-table movement they
// guarded). moveToPos heads for drainRallyPos, a concrete TILE Drain recomputes every tick (the squad's
// live anchor once one exists, else the staging room center) — NOT moveToRoom/attackTargetRoom: a
// room-membership destination let two stragglers each converging on "whichever room the OTHER one
// currently stands in" chase each other back and forth across a border forever, since each one's
// destination flipped the instant its target crossed (confirmed live). attack acts in range en route.
export class DrainAttacker extends Role {
  static override readonly priority = 94; // same table as DrainHealer — below supply(101)/transport(100)/miner(95): colony economy comes first, an offensive squad is expendable
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainAttackerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToPos", to: "drainRallyPos" },
    { do: "attack", from: { find: "structure", type: [STRUCTURE_TOWER] } },
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } }
  ];
}
