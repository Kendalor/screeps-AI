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
// Settlers spawn in parallel with the colonizer, not after it claims (project decision: faster bootstrap
// beats the risk of a wasted settler body on a failed claim). They stop being requested once any of:
//  - MAX_SETTLERS are already owned for this target;
//  - the colonizer's claimController call has hit a terminal failure code (ERR_ACCESS_DENIED — room
//    owned by someone else — or ERR_INVALID_TARGET — not a claimable controller at all; unlike
//    ERR_GCL_NOT_ENOUGH/ERR_FULL, which are retryable as the empire's GCL/room count changes, these two
//    can never resolve on their own, so pouring more settlers in after one is pure waste);
//  - the target has become self-sufficient (energyCapacity >= SELF_SUFFICIENT_ENERGY_CAP). This alone
//    isn't derivable from the sponsor's own ColonySnapshot — the target only becomes a real Colony once
//    its controller is claimed — so the constructor takes it as an explicit optional parameter, the same
//    pattern Operation.intents()'s colonyRequestParts uses for an externally-computed value an operation
//    needs but can't derive from its own snapshot alone. Colony (colony/index.ts) is the caller: it looks
//    the target up in the wider colony list it's constructed from before building each active Colonize.
//
// The SAME two conditions (terminal claim error, target self-sufficient) also drive removal: intents()
// emits removeColonizeTarget once either holds, deleting this target from ColonyMemory.colonizing so the
// operation stops being attached from the next tick on — the operation's own, explicit cleanup, not an
// implicit "no creeps left" inference.

import { roleDef } from "../behaviors/roles";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import { SETTLER_MIN_COST } from "../behaviors/roles/settler";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Terminal claimController codes: the claim can never succeed at this target, no matter how many times
// the colonizer retries — see claimStep in behaviors/interpreter.ts, which sets/clears this code.
const TERMINAL_CLAIM_ERRORS: ReadonlySet<CreepActionReturnCode | ERR_FULL | ERR_GCL_NOT_ENOUGH | ERR_ACCESS_DENIED> = new Set([
  ERR_ACCESS_DENIED,
  ERR_INVALID_TARGET
]);

export const MAX_SETTLERS = 4;
// Once the target colony can afford this much energy capacity on its own, it's expected to sustain
// itself through its own normal operations (Bootstrap et al) rather than the sponsor's settlers.
export const SELF_SUFFICIENT_ENERGY_CAP = 550;

export class Colonize extends Operation {
  public readonly kind = "colonize";

  public constructor(
    room: string,
    private readonly targetRoom: string,
    // The target's own energyCapacity, if it's already a real Colony (controller claimed). Undefined
    // while the claim hasn't landed yet — settlers still spawn during that window (see header).
    private readonly targetEnergyCapacity?: number
  ) {
    super(room);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return [...this.desiredColonizer(colony), ...this.desiredSettlers(colony)];
  }

  private desiredColonizer(colony: ColonySnapshot): CreepRequest[] {
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
        targetRoom: this.targetRoom
      }
    ];
  }

  /** True once the target has permanently failed — a terminal claimController code from this
   * operation's own colonizer. Shared by desiredSettlers (stop requesting) and intents() (remove the
   * target from ColonyMemory.colonizing entirely). */
  private claimFailedPermanently(colony: ColonySnapshot): boolean {
    const colonizers = this.owned(colony, "colonizer").filter(c => c.memory.targetRoom === this.targetRoom);
    const claimError = colonizers.find(c => c.memory.claimError !== undefined)?.memory.claimError;
    return claimError !== undefined && TERMINAL_CLAIM_ERRORS.has(claimError);
  }

  /** True once the target can sustain itself through its own normal operations — see
   * SELF_SUFFICIENT_ENERGY_CAP's doc. Shared by desiredSettlers and intents(), same reason as above. */
  private targetSelfSufficient(): boolean {
    return this.targetEnergyCapacity !== undefined && this.targetEnergyCapacity >= SELF_SUFFICIENT_ENERGY_CAP;
  }

  private desiredSettlers(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < SETTLER_MIN_COST) return [];
    if (this.targetSelfSufficient()) return [];
    if (this.claimFailedPermanently(colony)) return [];

    const settlers = this.owned(colony, "settler").filter(c => c.memory.targetRoom === this.targetRoom);
    if (settlers.length >= MAX_SETTLERS) return [];

    const body = orderBody(roleDef("settler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    return [
      {
        body,
        priority: roleDef("settler")!.priority,
        memory: { role: "settler", home: colony.name, op: this.name },
        targetRoom: this.targetRoom
      }
    ];
  }

  /** Removes this target from ColonyMemory.colonizing once its job is done or permanently failed — see
   * this file's header for why the same two conditions drive both "stop requesting settlers" and "stop
   * existing as an operation at all." Not gated on live creep count: the target reaching
   * self-sufficiency or the claim failing is true regardless of whether a colonizer/settler happens to
   * still be alive that exact tick, and either condition already implies no further useful work remains. */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (this.targetSelfSufficient() || this.claimFailedPermanently(colony)) {
      return [{ kind: "removeColonizeTarget", room: colony.name, target: this.targetRoom }];
    }
    return [];
  }
}
