// Colonize owns exactly one colonizer (claims the target's controller) sent at a single target room.
// Not wired into operationsFor() — no colony gets this by default (see operations/index.ts); a colony
// only carries it for a target listed in ColonyMemory.colonizing (snapshot.colonizing), written once by
// a flag/auto-pick handoff (addColonizeTarget — see colonizeFlags.ts/pickColonyTargets.ts) and read
// every tick by Colony's constructor (colony/index.ts) to attach a real, ongoing Colonize instance per
// target — the same durable-memory-list shape Reservation/Mining use for remotes, not a one-shot
// creep-spawning bypass. The colonizer body this operation requests spawns through the completely normal
// per-tick arbiter (empire/spawning.ts's planSpawning), same as every other operation's demand.
//
// The colonizer stops being requested the moment the target is claimed — targetEnergyCapacity is only
// ever defined once the target shows up as a real Colony (see its own doc below) — since the colonizer
// that landed the claim suicides that same tick (claimStep in behaviors/interpreter.ts) and would
// otherwise read as "zero owned, request another" the very next tick.
//
// Bootstrapping the newly-claimed room from nothing (harvest/build/upgrade, first spawn included) is no
// longer this operation's job: once claimed, the target shows up as a real Colony with spawns.length===0,
// which Bootstrap's own noSpawnRequests (operations/bootstrap.ts) now handles identically to a wiped
// established colony losing its spawn — one unified "owned room, no spawn" path instead of two. This
// also removes the awkward window where a target was claimed but not yet visible as its own Colony.
//
// The removal condition (target genuinely owned by someone else) still drives cleanup: intents() emits
// removeColonizeTarget once it holds, deleting this target from ColonyMemory.colonizing so the operation
// stops being attached from the next tick on. Success (claimed, spawn built) also removes it — Bootstrap
// takes over from there and Colonize itself has nothing left to do at a room it no longer needs to watch.

import { roleDef } from "../behaviors/roles";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { opName, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export class Colonize extends Operation {
  public readonly kind = "colonize";

  public constructor(
    room: string,
    private readonly targetRoom: string,
    // The target's own energyCapacity, if it's already a real Colony (controller claimed). Undefined
    // while the claim hasn't landed yet.
    private readonly targetEnergyCapacity?: number
  ) {
    super(room);
  }

  // Overridden to name by the TARGET, not the sponsor (base Operation.name's default) — same reasoning
  // as Attack.name: the metrics panel is already scoped to one colony (colony/metricsVisual.ts draws
  // colony.operations verbatim), so "colonize:<sponsor>" is always just this room's own name and tells a
  // player nothing when several colonize targets are in flight from the same sponsor at once.
  public override get name(): string {
    return opName(this.kind, this.targetRoom);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.desiredColonizer(colony);
  }

  private desiredColonizer(colony: ColonySnapshot): CreepRequest[] {
    // Already claimed: targetEnergyCapacity is only ever defined once the target shows up in the wider
    // colony list Colony's constructor builds allSnapshots from (see colony/index.ts) — i.e. the
    // controller is genuinely ours. The colonizer that landed the claim suicides the same tick
    // (claimStep in behaviors/interpreter.ts), so without this check owned() would see zero live
    // colonizers on the very next tick and request a brand new one for a target that's already done.
    if (this.targetEnergyCapacity !== undefined) return [];
    // Affordability gate: no point requesting a colonizer the home room can never spawn (CLAIM is 600).
    if (colony.energyCapacity < COLONIZER_COST) return [];
    // One colonizer, full stop — claimController is a one-time act, so once it's fired (or one is
    // already en route) there is nothing left for a second one to do at this target.
    if (this.owned(colony, "colonizer").some(c => c.memory.targetRoom === this.targetRoom)) return [];

    const body = orderBody(roleDef("colonizer")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    return [
      {
        body,
        priority: roleDef("colonizer")!.priority,
        memory: { role: "colonizer", home: colony.name, op: this.name },
        targetRoom: this.targetRoom,
        // Pinned to the sponsor — same reasoning as reservation.ts's claimer pin: without this, planSpawning's
        // "nearest colony that can afford it" fallback lets an unrelated colony's idle spawn get borrowed for
        // this sponsor's colonizer, which is never what's wanted (the sponsor should wait, not steal a slot
        // from a colony this operation has nothing to do with).
        spawnRoom: colony.name
      }
    ];
  }

  /** True once the target has permanently failed — this operation's own colonizer has seen the target
   * controller genuinely owned by another player (memory.claimOwnedByOther — see claimStep in
   * behaviors/interpreter.ts). Deliberately NOT keyed off claimError/ERR_INVALID_TARGET generally: a
   * contested reservation (attackController fighting it down) is a temporary, winnable state — a
   * colonizer can die mid-fight and a fresh one just resumes, never terminal on its own. Shared by
   * intents() (remove the target from ColonyMemory.colonizing entirely). */
  private claimFailedPermanently(colony: ColonySnapshot): boolean {
    const colonizers = this.owned(colony, "colonizer").filter(c => c.memory.targetRoom === this.targetRoom);
    return colonizers.some(c => c.memory.claimOwnedByOther === true);
  }

  /** True once the target has succeeded: its controller is claimed (targetEnergyCapacity defined — see
   * the constructor's doc). From here on the target is a real Colony and Bootstrap's own noSpawnRequests
   * (operations/bootstrap.ts) takes over building it up from nothing, same as any other spawn-less owned
   * room — this operation's job (landing the claim) is already done. */
  private targetClaimed(): boolean {
    return this.targetEnergyCapacity !== undefined;
  }

  /** Removes this target from ColonyMemory.colonizing once its job is done or permanently failed — see
   * this file's header for why the same conditions drive both "stop requesting" and "stop existing as an
   * operation at all." Not gated on live creep count: the target having been claimed or the claim failing
   * is true regardless of whether a colonizer happens to still be alive that exact tick, and either
   * condition already implies no further useful work remains for this operation. */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (this.targetClaimed() || this.claimFailedPermanently(colony)) {
      return [{ kind: "removeColonizeTarget", room: colony.name, target: this.targetRoom }];
    }
    return [];
  }
}
