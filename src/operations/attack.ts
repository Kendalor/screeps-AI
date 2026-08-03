// Attack pools every target room this colony is sponsoring (ColonyMemory.attacking, snapshot.attacking)
// behind a small shared attacker pool, same shape as Defense pools invaded rooms behind a shared defender
// pool — not wired into operationsFor() (see operations/index.ts), attached only when the colony has at
// least one listed target (Colony's constructor, straight off a flag handoff's addAttackTarget — see
// attackFlags.ts). Up to MAX_ATTACKERS live at a time: clearing an invader core is opportunistic
// background work, not urgent enough to justify a large body, but capping at 1 serializes every queued
// target behind a single multi-hundred-tick round trip even though one creep easily has life to spare for
// the kill itself — a level-0 core's 100,000 hits, a 1300-energy-cap body's 6 ATTACK parts (180 dmg/tick),
// dies in ~556 ticks, well under CREEP_LIFE_TIME's 1500 even after several-hundred-tick travel to a
// PRUNE_RADIUS-distant room. 2 lets two distant queued targets clear in parallel instead of waiting out
// each other's full travel+kill+respawn cycle. When a creep's current target clears, the SAME creep is
// reassigned to the next queued target instead of dying and respawning fresh — a surviving attacker is
// already paid for and often already near the next hostile room.
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

export const MAX_ATTACKERS = 2;

export class Attack extends Operation {
  public readonly kind = "attack";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < ATTACKER_MIN_COST) return [];
    const open = this.openTargets(colony);
    if (open.length === 0) return [];
    if (this.owned(colony, "attacker").length >= MAX_ATTACKERS) return [];

    // A fresh spawn is never "already assigned," so the staffed set is exactly today's live attackers —
    // same target-spreading rule intents() applies to reassignment.
    const target = this.nextUnstaffedTarget(open, this.staffedTargets(colony, open));
    const body = orderBody(roleDef("attacker")?.body(colony.energyCapacity, { hasContainer: false, hasLink: false }) ?? []);
    return [
      {
        body,
        priority: roleDef("attacker")!.priority,
        memory: { role: "attacker", home: colony.name, op: this.name, attackTargetRoom: target },
        targetRoom: target
      }
    ];
  }

  /** Every sponsored target not yet seen clear — what's still worth an attacker's time. */
  private openTargets(colony: ColonySnapshot): string[] {
    return colony.attacking.filter(t => !this.roomCleared(colony, t));
  }

  /** Which of `open` already have a live attacker pointed at them. */
  private staffedTargets(colony: ColonySnapshot, open: string[]): Set<string> {
    return new Set(
      this.owned(colony, "attacker")
        .map(c => c.memory.attackTargetRoom)
        .filter((r): r is string => r !== undefined && open.includes(r))
    );
  }

  /** The first open target not in `staffed`, so a second (or later) pool member spreads onto a distinct
   * target instead of piling behind whichever one happened to be open[0] — the whole point of
   * MAX_ATTACKERS > 1 is clearing distinct targets in parallel, not queueing extra bodies on the same
   * fight. Falls back to open[0] once every open target is already staffed, so a spare pool slot still
   * reinforces rather than sitting idle. */
  private nextUnstaffedTarget(open: string[], staffed: Set<string>): string {
    return open.find(t => !staffed.has(t)) ?? open[0];
  }

  /** True once `room` has been seen this tick (someone in the empire has vision of it) with no hostiles
   * left. Vision-gated via VisibleRoom.hostileCount (snapshot/types.ts) — a room absent from
   * `visibleRooms` must never read as cleared just because no entry says otherwise, or a target the
   * colony has never actually looked at would silently cancel the strike the instant it's placed. */
  private roomCleared(colony: ColonySnapshot, room: string): boolean {
    return colony.visibleRooms.find(r => r.room === room)?.hostileCount === 0;
  }

  /** Keeps the shared attacker pool pointed at open targets (spreading across distinct ones, see
   * nextUnstaffedTarget), and drops any target that's been cleared. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = colony.attacking
      .filter(t => this.roomCleared(colony, t))
      .map(target => ({ kind: "removeAttackTarget", room: colony.name, target }));

    const open = this.openTargets(colony);
    if (open.length > 0) {
      // Mutated as assignments are made below so two creeps both needing reassignment this tick spread
      // across distinct targets instead of both grabbing the same one.
      const staffed = this.staffedTargets(colony, open);
      // Reassigns only an attacker whose current room has cleared (or was never set) — same rule as
      // Defense's defendTargetRoomIntents, so a mid-fight attacker is never yanked off a still-open target.
      for (const creep of this.owned(colony, "attacker")) {
        if (creep.memory.attackTargetRoom && open.includes(creep.memory.attackTargetRoom)) continue;
        const room = this.nextUnstaffedTarget(open, staffed);
        staffed.add(room);
        out.push({ kind: "setAttackTargetRoom", creep: creep.id, room });
      }
    }
    return out;
  }
}
