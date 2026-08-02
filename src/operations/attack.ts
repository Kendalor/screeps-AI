// Attack owns one attacker creep sent at a single target room to clear every hostile there. Not wired
// into operationsFor() — no colony gets this by default (see operations/index.ts); a colony only carries
// it for a target listed in ColonyMemory.attacking (snapshot.attacking), written once by a flag handoff
// (addAttackTarget — see attackFlags.ts) and read every tick by Colony's constructor to attach a real
// Attack instance per target — the same durable-memory-list shape Colonize uses (see operations/colonize.ts's
// header) rather than a one-shot creep-spawning bypass. One Attack instance is permanently bound to one
// target room for its whole life — unlike Defense, which reassigns a shared defender pool across whichever
// room currently has hostiles, this is a standing order against one specific room.
//
// Stops requesting (and removes itself from ColonyMemory.attacking) once that room has been *seen* with
// zero hostile creeps in it — vision-gated, not merely "no live attacker creep": a target the colony has
// never scouted must not read as already-clear. See roomCleared() below.

import { roleDef } from "../behaviors/roles";
import { ATTACKER_MIN_COST } from "../behaviors/roles/attacker";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import { opName, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const MAX_ATTACKERS = 1;

export class Attack extends Operation {
  public readonly kind = "attack";

  public constructor(room: string, private readonly targetRoom: string) {
    super(room);
  }

  // Overridden to name by the TARGET, not the sponsor (base Operation.name's default): the metrics panel
  // is already scoped to one colony (see colony/metricsVisual.ts drawing colony.operations verbatim), so
  // "attack:<sponsor>" is always just this room's own name — useless. "attack:<target>" is the one piece
  // of information the panel can't already infer, and it's what a player actually wants to see at a
  // glance when several Attack instances (different targets) are live on the same colony at once.
  public override get name(): string {
    return opName(this.kind, this.targetRoom);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < ATTACKER_MIN_COST) return [];
    if (this.roomCleared(colony)) return [];
    if (this.owned(colony, "attacker").filter(c => c.memory.attackTargetRoom === this.targetRoom).length >= MAX_ATTACKERS) {
      return [];
    }

    const body = orderBody(roleDef("attacker")?.body(colony.energyCapacity, { hasContainer: false, hasLink: false }) ?? []);
    return [
      {
        body,
        priority: roleDef("attacker")!.priority,
        memory: { role: "attacker", home: colony.name, op: this.name, attackTargetRoom: this.targetRoom },
        targetRoom: this.targetRoom
      }
    ];
  }

  /** True once the target room has been seen this tick (someone in the empire has vision of it) with no
   * hostile creeps left. Vision-gated via VisibleRoom.hostileCount (snapshot/types.ts) — a room absent
   * from `visibleRooms` must never read as cleared just because no entry says otherwise, or a target the
   * colony has never actually looked at would silently cancel the strike the instant it's placed. */
  private roomCleared(colony: ColonySnapshot): boolean {
    return colony.visibleRooms.find(r => r.room === this.targetRoom)?.hostileCount === 0;
  }

  /** Removes this target from ColonyMemory.attacking once the room is clear — see this file's header. */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (this.roomCleared(colony)) {
      return [{ kind: "removeAttackTarget", room: colony.name, target: this.targetRoom }];
    }
    return [];
  }
}
