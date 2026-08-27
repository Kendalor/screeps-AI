// SimpleHeal: sponsors up to `wanted` SimpleHealerRole creeps sent at a single target room, on the shared
// SingleTargetFlagOperation shape (see that file's header for the full demand/lifetime state machine) —
// attached only while ColonyMemory.singleTargetOps["simpleHeal"][target] exists (a flag handoff via
// empire/singleTargetFlags.ts), never wired into operationsFor() (see operations/index.ts).
//
// Same as SimpleBaitTower/Demolish/AttackController, the spawned creep tracks the triggering flag's live
// position (its own step table in behaviors/roles/simpleHealer.ts uses moveToFlag) — dragging the flag
// redirects the healer immediately, same as every other member of this family.
//
// Original shape (pre-generalization) was a flat "≥1 owned" check that never latched — effectively always
// requesting a replacement. That reads as "constant"; kept as the default here so an un-colored
// simpleHeal flag keeps today's live behavior exactly. A WHITE flag now gets the one-shot-per-slot
// behavior SimpleBaitTower always had.

import type { RoleName } from "../memory/schema";
import { SingleTargetFlagOperation, type SingleTargetFlagOperationClass } from "./singleTargetFlagOperation";
import { SIMPLE_HEALER_MIN_COST } from "../behaviors/roles/simpleHealer";

export const SIMPLE_HEALER_ROLE: RoleName = "simpleHealer";

export class SimpleHealOperation extends SingleTargetFlagOperation {
  public static readonly kind = "simpleHeal";
  public static readonly sponsorConfig = { minCost: SIMPLE_HEALER_MIN_COST };
  public static readonly defaultLifetime = "constant" as const;
  public static readonly supportedLifetimes = new Set(["oneShot", "constant"] as const);
  public static readonly role = SIMPLE_HEALER_ROLE;

  public readonly kind = SimpleHealOperation.kind;
  protected readonly role = SIMPLE_HEALER_ROLE;
}

// Compile-time proof the class satisfies the factory contract flags modules construct against — see
// SimpleBaitTowerOperation's identical check for why.
SimpleHealOperation satisfies SingleTargetFlagOperationClass;
