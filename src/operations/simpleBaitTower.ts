// SimpleBaitTower: sponsors up to `wanted` SimpleBaitTowerRole creeps sent at a single target room, on the
// shared SingleTargetFlagOperation shape (see that file's header for the full demand/lifetime state
// machine) — attached only while ColonyMemory.singleTargetOps["simpleBaitTower"][target] exists (a flag
// handoff via empire/singleTargetFlags.ts), never wired into operationsFor() (see operations/index.ts).
//
// The one real quirk: its body is deliberately NOT reordered by survival priority (skipBodyOrdering) —
// every other role's body gets orderBody()'d (TOUGH first, MOVE last; see spawn/body.ts), but the bait
// creep's whole point is soaking tower fire in a SPECIFIC part sequence
// (behaviors/roles/simpleBaitTower.ts's own body layout), so the array it produces must reach the spawn
// request untouched.
//
// The bait creep's own enter/retreat/heal/re-enter behavior lives in its own step table — see
// behaviors/roles/simpleBaitTower.ts.

import type { RoleName } from "../memory/schema";
import { SingleTargetFlagOperation, type SingleTargetFlagOperationClass } from "./singleTargetFlagOperation";
import { SIMPLE_BAIT_TOWER_MIN_COST } from "../behaviors/roles/simpleBaitTower";

export const SIMPLE_BAIT_TOWER_ROLE: RoleName = "simpleBaitTower";

export class SimpleBaitTowerOperation extends SingleTargetFlagOperation {
  public static readonly kind = "simpleBaitTower";
  public static readonly sponsorConfig = { minCost: SIMPLE_BAIT_TOWER_MIN_COST };
  // Original shape: never replace a dead bait creep once its slot has been used.
  public static readonly defaultLifetime = "oneShot" as const;
  public static readonly supportedLifetimes = new Set(["oneShot", "constant"] as const);
  public static readonly role = SIMPLE_BAIT_TOWER_ROLE;

  public readonly kind = SimpleBaitTowerOperation.kind;
  protected readonly role = SIMPLE_BAIT_TOWER_ROLE;
  protected override readonly skipBodyOrdering = true;
}

// Compile-time proof the class actually satisfies the factory contract flags modules construct against
// (SingleTargetFlagOperationClass's `new (...)` signature plus its static fields) — a mismatch here is a
// build error, not a runtime surprise the first time a flag is placed.
SimpleBaitTowerOperation satisfies SingleTargetFlagOperationClass;
