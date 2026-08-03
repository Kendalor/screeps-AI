// Attack pools every target room this colony is sponsoring (ColonyMemory.attacking, snapshot.attacking)
// behind ONE shared attacker, same shape as Defense pools invaded rooms behind a shared defender pool —
// not wired into operationsFor() (see operations/index.ts), attached only when the colony has at least
// one listed target (Colony's constructor, straight off a flag handoff's addAttackTarget — see
// attackFlags.ts). One live attacker at a time (MAX_ATTACKERS): clearing an invader core is opportunistic
// background work, not urgent enough to justify parallel bodies. When its current target clears, the
// SAME creep is reassigned to the next queued target instead of dying and respawning fresh — a surviving
// attacker is already paid for and often already near the next hostile room.
//
// Stops sponsoring a given target (removes it from ColonyMemory.attacking) once that room has been *seen*
// with zero hostile creeps/structures in it — vision-gated, not merely "no live attacker creep": a target
// the colony has never scouted must not read as already-clear. See roomsToClear() below.

import { roleDef } from "../behaviors/roles";
import { ATTACKER_MIN_COST } from "../behaviors/roles/attacker";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const MAX_ATTACKERS = 1;

export class Attack extends Operation {
  public readonly kind = "attack";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < ATTACKER_MIN_COST) return [];
    if (this.openTargets(colony).length === 0) return [];
    if (this.owned(colony, "attacker").length >= MAX_ATTACKERS) return [];

    const body = orderBody(roleDef("attacker")?.body(colony.energyCapacity, { hasContainer: false, hasLink: false }) ?? []);
    return [
      {
        body,
        priority: roleDef("attacker")!.priority,
        memory: { role: "attacker", home: colony.name, op: this.name, attackTargetRoom: this.openTargets(colony)[0] },
        targetRoom: this.openTargets(colony)[0]
      }
    ];
  }

  /** Every sponsored target not yet seen clear — what's still worth an attacker's time. */
  private openTargets(colony: ColonySnapshot): string[] {
    return colony.attacking.filter(t => !this.roomCleared(colony, t));
  }

  /** True once `room` has been seen this tick (someone in the empire has vision of it) with no hostiles
   * left. Vision-gated via VisibleRoom.hostileCount (snapshot/types.ts) — a room absent from
   * `visibleRooms` must never read as cleared just because no entry says otherwise, or a target the
   * colony has never actually looked at would silently cancel the strike the instant it's placed. */
  private roomCleared(colony: ColonySnapshot, room: string): boolean {
    return colony.visibleRooms.find(r => r.room === room)?.hostileCount === 0;
  }

  /** Keeps the shared attacker pool pointed at an open target, and drops any target that's been cleared. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = colony.attacking
      .filter(t => this.roomCleared(colony, t))
      .map(target => ({ kind: "removeAttackTarget", room: colony.name, target }));

    const open = this.openTargets(colony);
    if (open.length > 0) {
      // Reassigns only an attacker whose current room has cleared (or was never set) — same rule as
      // Defense's defendTargetRoomIntents, so a mid-fight attacker is never yanked off a still-open target.
      for (const creep of this.owned(colony, "attacker")) {
        if (creep.memory.attackTargetRoom && open.includes(creep.memory.attackTargetRoom)) continue;
        out.push({ kind: "setAttackTargetRoom", creep: creep.id, room: open[0] });
      }
    }
    return out;
  }
}
