// Colonize owns one colonizer (claims the target's controller) and up to MAX_SETTLERS settler creeps
// (bootstrap the room from nothing once claimed), both sent at a single target room. Not wired into
// operationsFor() — no colony gets this by default (see operations/index.ts). Standalone piece: the
// empire-scoped picker that decides WHICH room to colonize and constructs this operation with that
// target doesn't exist yet (a later piece). Until then this is constructed directly (console/tests) with
// an explicit target, same shape Reservation would have if a remote room only ever needed one claimer.
//
// Deliberately no ColonyMemory field of its own yet: today's target is a plain constructor argument, not
// a persisted pick — see the base Operation contract (fresh from `room` alone every tick) for why this
// still fits that shape without committing to a memory layout the future picker hasn't decided.
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

import { roleDef } from "../behaviors/roles";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import { SETTLER_MIN_COST } from "../behaviors/roles/settler";
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

  private desiredSettlers(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < SETTLER_MIN_COST) return [];
    if (this.targetEnergyCapacity !== undefined && this.targetEnergyCapacity >= SELF_SUFFICIENT_ENERGY_CAP) return [];

    const colonizers = this.owned(colony, "colonizer").filter(c => c.memory.targetRoom === this.targetRoom);
    const claimError = colonizers.find(c => c.memory.claimError !== undefined)?.memory.claimError;
    if (claimError !== undefined && TERMINAL_CLAIM_ERRORS.has(claimError)) return [];

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
}
