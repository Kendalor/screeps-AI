// AttackController: sponsors up to `wanted` AttackControllerRole creeps sent at a single target room, on
// the shared SingleTargetFlagOperation shape (see that file's header for the full demand/lifetime state
// machine) — attached only while ColonyMemory.singleTargetOps["attackController"][target] exists (a flag
// handoff via empire/singleTargetFlags.ts), never wired into operationsFor() (see operations/index.ts).
//
// The creep's own advance/attack behavior lives in its own step table — see
// behaviors/roles/attackController.ts.

import type { RoleName } from "../memory/schema";
import { SingleTargetFlagOperation, type SingleTargetFlagOperationClass } from "./singleTargetFlagOperation";
import { ATTACK_CONTROLLER_MIN_COST } from "../behaviors/roles/attackController";

export const ATTACK_CONTROLLER_ROLE: RoleName = "attackController";

export class AttackControllerOperation extends SingleTargetFlagOperation {
  public static readonly kind = "attackController";
  public static readonly sponsorConfig = { minCost: ATTACK_CONTROLLER_MIN_COST };
  // Original shape: never replace a dead creep once its slot has been used.
  public static readonly defaultLifetime = "oneShot" as const;
  public static readonly supportedLifetimes = new Set(["oneShot", "constant"] as const);

  public readonly kind = AttackControllerOperation.kind;
  protected readonly role = ATTACK_CONTROLLER_ROLE;
}

// Compile-time proof the class satisfies the factory contract flags modules construct against — see
// SimpleBaitTowerOperation's identical check for why.
AttackControllerOperation satisfies SingleTargetFlagOperationClass;
