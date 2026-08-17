// Demolish: sponsors up to `wanted` DemolisherRole creeps sent at a single target room, on the shared
// SingleTargetFlagOperation shape (see that file's header for the full demand/lifetime state machine) —
// attached only while ColonyMemory.singleTargetOps["demolish"][target] exists (a flag handoff via
// empire/singleTargetFlags.ts), never wired into operationsFor() (see operations/index.ts).
//
// The demolisher creep's own step table lives in its own file — see behaviors/roles/demolisher.ts.

import type { RoleName } from "../memory/schema";
import { SingleTargetFlagOperation, type SingleTargetFlagOperationClass } from "./singleTargetFlagOperation";
import { DEMOLISHER_MIN_COST } from "../behaviors/roles/demolisher";

export const DEMOLISHER_ROLE: RoleName = "demolisher";

export class DemolishOperation extends SingleTargetFlagOperation {
  public static readonly kind = "demolish";
  public static readonly sponsorConfig = { minCost: DEMOLISHER_MIN_COST };
  // Original shape (pre-generalization) was a flat "≥1 owned" check that never latched — effectively
  // always requesting a replacement. That reads as "constant"; kept as the default here rather than
  // silently switching to "oneShot", so an un-colored demolish flag keeps today's live behavior exactly.
  // A WHITE flag now gets the (arguably more correct) one-shot-per-slot behavior SimpleBaitTower always had.
  public static readonly defaultLifetime = "constant" as const;
  public static readonly supportedLifetimes = new Set(["oneShot", "constant"] as const);

  public readonly kind = DemolishOperation.kind;
  protected readonly role = DEMOLISHER_ROLE;
}

// Compile-time proof the class satisfies the factory contract flags modules construct against — see
// SimpleBaitTowerOperation's identical check for why.
DemolishOperation satisfies SingleTargetFlagOperationClass;
