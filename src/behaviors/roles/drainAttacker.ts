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

// The Drain Energy operation's (issue #34/ADR 0006) melee squad member: sits at the front of the
// formation and prioritizes towers (the source of the operation's namesake energy drain) over any
// hostile creep, falling back to the most threatening hostile once no tower remains in range. moveToPos
// alone carries it everywhere — see drainHealer.ts's header for why the old moveToRoom+moveToPos split
// was a real stuck-state bug (a healer confirmed frozen at home for hundreds of ticks live on shard0,
// 2026-08-05) and why a single always-fresh squadTargetPos (set every tick by operations/drain.ts's
// intents(), for every squad member unconditionally) replaces it instead of patching around it.
// Both attack steps carry standStill:true for the same reason drainHealer's heal step does (see its
// header): this creep is the squad LEADER (drain.ts's leaderOf prefers the attacker whenever alive) —
// everyone else's formation offset is computed relative to ITS position, so if attack's own travelTo
// were ever allowed to grab primary-step status and drag the leader off toward a hostile/tower instead
// of its assigned squadTargetPos, the whole formation reference point would drift out from under every
// follower at once. standStill keeps attack action-only (fires in range, never moves) in every context.
export class DrainAttacker extends Role {
  static override readonly priority = 110; // same table as Attacker/Defender — an ordered squad op is as urgent as either
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainAttackerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToPos", to: "squadTargetPos" },
    { do: "attack", from: { find: "structure", type: [STRUCTURE_TOWER] }, standStill: true },
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" }, standStill: true }
  ];
}
