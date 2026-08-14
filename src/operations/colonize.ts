// Colonize owns one colonizer (claims the target's controller) and up to MAX_SETTLERS settler creeps
// (bootstrap the room from nothing once claimed), both sent at a single target room. Not wired into
// operationsFor() — no colony gets this by default (see operations/index.ts); a colony only carries it
// for a target listed in ColonyMemory.colonizing (snapshot.colonizing), written once by a flag/auto-pick
// handoff (addColonizeTarget — see colonizeFlags.ts/pickColonyTargets.ts) and read every tick by
// Colony's constructor (colony/index.ts) to attach a real, ongoing Colonize instance per target — the
// same durable-memory-list shape Reservation/Mining use for remotes, not a one-shot creep-spawning
// bypass. The colonizer/settler bodies this operation requests spawn through the completely normal
// per-tick arbiter (empire/spawning.ts's planSpawning), same as every other operation's demand.
//
// The colonizer itself stops being requested the moment the target is claimed — targetEnergyCapacity is
// only ever defined once the target shows up as a real Colony (see its own doc below) — since the
// colonizer that landed the claim suicides that same tick (claimStep in behaviors/interpreter.ts) and
// would otherwise read as "zero owned, request another" the very next tick.
//
// Settlers spawn in parallel with the colonizer, not after it claims (project decision: faster bootstrap
// beats the risk of a wasted settler body on a failed claim). They stop being requested once any of:
//  - MAX_SETTLERS are already owned for this target;
//  - the colonizer has seen the target controller genuinely owned by another player
//    (memory.claimOwnedByOther — see claimStep in behaviors/interpreter.ts). Deliberately NOT any
//    claimController failure code: a contested reservation (attackController fighting it down, possibly
//    across several colonizer lives) is temporary and winnable, never grounds to give up on;
//  - the target has succeeded — either it has its own spawn built (targetSpawnBuilt; see targetColonized's
//    doc) or it has become self-sufficient (energyCapacity >= SELF_SUFFICIENT_ENERGY_CAP). Neither is
//    derivable from the sponsor's own ColonySnapshot — the target only becomes a real Colony once its
//    controller is claimed — so the constructor takes both as explicit optional parameters, the same
//    pattern Operation.intents()'s colonyRequestParts uses for an externally-computed value an operation
//    needs but can't derive from its own snapshot alone. Colony (colony/index.ts) is the caller: it looks
//    the target up in the wider colony list it's constructed from before building each active Colonize.
//
// The SAME conditions (target genuinely owned by someone else, target colonized, target self-sufficient)
// also drive removal: intents() emits removeColonizeTarget once any holds, deleting this target from
// ColonyMemory.colonizing so the operation stops being attached from the next tick on — the operation's
// own, explicit cleanup, not an implicit "no creeps left" inference.

import { roleDef } from "../behaviors/roles";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import { SELF_SUFFICIENT_ENERGY_CAP, SETTLER_MIN_COST } from "../behaviors/roles/settler";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { opName, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const MAX_SETTLERS = 4;
// Owned by behaviors/roles/settler.ts (the settler's own recycle threshold) — re-exported here since
// every existing caller/test imports it from this file. See settler.ts's doc for why the same threshold
// drives both the settler's self-recycle decision and Colonize's stop-sponsoring decision.
export { SELF_SUFFICIENT_ENERGY_CAP };

export class Colonize extends Operation {
  public readonly kind = "colonize";

  public constructor(
    room: string,
    private readonly targetRoom: string,
    // The target's own energyCapacity, if it's already a real Colony (controller claimed). Undefined
    // while the claim hasn't landed yet — settlers still spawn during that window (see header).
    private readonly targetEnergyCapacity?: number,
    // Whether the target's own spawn has been built yet (its ColonySnapshot lists at least one spawn).
    // Only meaningful once targetEnergyCapacity is defined (the controller is claimed) — see
    // targetColonized's doc for why this alone already counts as success.
    private readonly targetSpawnBuilt = false
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
    return [...this.desiredColonizer(colony), ...this.desiredSettlers(colony)];
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
   * desiredSettlers (stop requesting) and intents() (remove the target from ColonyMemory.colonizing
   * entirely). */
  private claimFailedPermanently(colony: ColonySnapshot): boolean {
    const colonizers = this.owned(colony, "colonizer").filter(c => c.memory.targetRoom === this.targetRoom);
    return colonizers.some(c => c.memory.claimOwnedByOther === true);
  }

  /** True once the target can sustain itself through its own normal operations — see
   * SELF_SUFFICIENT_ENERGY_CAP's doc. Shared by desiredSettlers and intents(), same reason as above. */
  private targetSelfSufficient(): boolean {
    return this.targetEnergyCapacity !== undefined && this.targetEnergyCapacity >= SELF_SUFFICIENT_ENERGY_CAP;
  }

  /** True once the target has succeeded outright: its controller is claimed (targetEnergyCapacity
   * defined — see the constructor's doc) AND its own first spawn is built. This is a strictly earlier
   * success signal than targetSelfSufficient — a colony with a fresh spawn is done needing the sponsor's
   * settlers well before it climbs to SELF_SUFFICIENT_ENERGY_CAP's energy capacity, since from that point
   * on Bootstrap and the rest of its own normal operations take over growing it. Shared by
   * desiredSettlers and intents(), same reason as targetSelfSufficient. */
  private targetColonized(): boolean {
    return this.targetEnergyCapacity !== undefined && this.targetSpawnBuilt;
  }

  private desiredSettlers(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < SETTLER_MIN_COST) return [];
    if (this.targetColonized() || this.targetSelfSufficient()) return [];
    if (this.claimFailedPermanently(colony)) return [];

    const settlers = this.owned(colony, "settler").filter(c => c.memory.targetRoom === this.targetRoom);
    if (settlers.length >= MAX_SETTLERS) return [];

    const body = orderBody(roleDef("settler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    return [
      {
        body,
        priority: roleDef("settler")!.priority,
        memory: { role: "settler", home: colony.name, op: this.name },
        targetRoom: this.targetRoom,
        // Pinned to the sponsor — see desiredColonizer's comment above. Settler's priority (65) is tuned to
        // beat a sponsor's OWN economy roles (see settler.ts), not to win a spawn slot on some other colony
        // entirely; unpinned, a busy sponsor spawn let planSpawning reroute settler demand onto a completely
        // unrelated colony's spawn, starving that colony's own lower-priority requests indefinitely.
        spawnRoom: colony.name
      }
    ];
  }

  /** Removes this target from ColonyMemory.colonizing once its job is done or permanently failed — see
   * this file's header for why the same conditions drive both "stop requesting settlers" and "stop
   * existing as an operation at all." Not gated on live creep count: the target having succeeded
   * (colonized or self-sufficient) or the claim failing is true regardless of whether a colonizer/settler
   * happens to still be alive that exact tick, and either condition already implies no further useful
   * work remains. */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (this.targetColonized() || this.targetSelfSufficient() || this.claimFailedPermanently(colony)) {
      return [{ kind: "removeColonizeTarget", room: colony.name, target: this.targetRoom }];
    }
    return [];
  }
}
