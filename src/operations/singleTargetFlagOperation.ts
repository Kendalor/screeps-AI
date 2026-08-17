// Shared shape for every "one flag sponsors up to N creeps of one role at a single target room" operation
// (SimpleBaitTower, Demolish, SimpleHeal, AttackController, and any future member of the family — see the
// architecture review this generalized from: those four were near-identical hand-copies of each other,
// duplicated four times over with only the role name and body varying). A concrete subclass supplies just
// the role and its own body-building quirks (SimpleBaitTower's unordered body is the one real exception —
// see `orderBody` below); this class owns the demand/lifetime state machine every member shares.
//
// Lifetime (memory/schema.ts's OperationLifetime) is a property of the DURABLE STATE
// (ColonyMemory.singleTargetOps[kind][target].lifetime), resolved once at flag-handoff time from the
// flag's color (empire/flagRequest.ts's lifetimeOf) and threaded through unchanged from there — this class
// never reads Game.flags itself.
//
// "oneShot": desiredCreeps tops owned creeps up to `wanted` minus `spawnedCount` — the running count of
// slots ever used (not currently-alive count), so a creep that dies never frees its slot back up. Once
// every wanted slot has been spawned at least once AND nothing is left alive, intents() emits
// endSingleTargetOp to detach the operation itself (see that intent's own doc for why the entry survives
// one more tick after that, for the flags module's own orphan-flag cleanup).
//
// "constant": desiredCreeps tops owned creeps up to `wanted` directly (never looks at `spawnedCount`) and
// never self-terminates — it stops only when the flag is removed (the flags module's own reconciliation
// pass emits clearSingleTargetOp), same shape Drain/Parade already use for their own scalar targets.

import { roleDef } from "../behaviors/roles";
import type { OperationLifetime, RoleName, SingleTargetOpState } from "../memory/schema";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation, type SponsorConfig } from "./operation";

/**
 * A subclass's static contract. `defaultLifetime` is what a flag with no color-based override resolves
 * to (see empire/flagRequest.ts's lifetimeOf); `supportedLifetimes` is the failsafe — a flag whose color
 * resolves to a lifetime this class doesn't support is a rejected handoff, not a silent reinterpretation
 * (see empire/singleTargetFlags.ts's runSingleTargetFlags). Both are readonly statics because they
 * describe the CLASS, not any one instance — reachable without constructing an operation, exactly where
 * `sponsorConfig` already lives.
 */
export interface SingleTargetFlagOperationClass {
  readonly kind: string;
  readonly sponsorConfig: SponsorConfig;
  readonly defaultLifetime: OperationLifetime;
  readonly supportedLifetimes: ReadonlySet<OperationLifetime>;
  new (room: string, target: string, state: SingleTargetOpState): SingleTargetFlagOperation;
}

export abstract class SingleTargetFlagOperation extends Operation {
  /** The one role this operation spawns. Concrete subclasses each own exactly one role, same as every
   * predecessor (SimpleBaitTower/Demolish/SimpleHeal/AttackController all had exactly one). */
  protected abstract readonly role: RoleName;

  /** Stamped onto the spawned creep's memory (CreepMemory.followFlag) so a role whose step table tracks
   * the flag's live position (moveToFlag) can read it — true for every current member of the family.
   * Overridden false only by an operation whose creep never tracks the flag (SimpleHeal's original
   * shape — its role resolves targetRoom once at handoff instead). */
  protected readonly stampsFollowFlag: boolean = true;

  /** SimpleBaitTower's one real quirk: its body soaks tower fire in a SPECIFIC part sequence and must NOT
   * be reordered by survival priority the way every other role's body is (see spawn/body.ts's orderBody).
   * False for every other current member — override true only for a role with the same requirement. */
  protected readonly skipBodyOrdering: boolean = false;

  public constructor(
    room: string,
    private readonly targetRoom: string,
    protected readonly state: SingleTargetOpState
  ) {
    super(room);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const wanted = this.state.wanted;
    if (wanted <= 0) return []; // ended (see SingleTargetOpState.wanted's "wanted <= 0 reads as absent" doc) or never set

    const owned = this.owned(colony, this.role).length;
    let outstanding: number;
    if (this.state.lifetime === "oneShot") {
      // Never re-open a used slot: bounded by both the remaining quota (wanted - spawnedCount) and how
      // many are currently alive (wanted - owned), same double-throttle SimpleBaitTower originated.
      const missing = wanted - this.state.spawnedCount;
      if (missing <= 0) return [];
      outstanding = Math.min(missing, wanted - owned);
    } else {
      // "constant": top back up to `wanted` against live count only, forever — spawnedCount is unused.
      outstanding = wanted - owned;
    }
    if (outstanding <= 0) return [];

    const def = roleDef(this.role);
    if (!def) return [];
    const rawBody = def.body(colony.energyCapacity, { hasContainer: false, hasLink: false });
    const body = this.skipBodyOrdering ? rawBody : orderBody(rawBody);
    if (body.length === 0) return [];

    return Array.from({ length: outstanding }, () => ({
      body: [...body],
      priority: def.priority,
      memory: {
        role: this.role,
        home: colony.name,
        op: this.name,
        followFlag: this.stampsFollowFlag ? this.state.flag : undefined
      },
      targetRoom: this.targetRoom,
      spawnRoom: colony.name
    }));
  }

  public override intents(colony: ColonySnapshot): Intent[] {
    if (this.state.lifetime !== "oneShot") return []; // "constant" never latches/self-terminates

    const wanted = this.state.wanted;
    const owned = this.owned(colony, this.role);

    // Newly-owned creeps this tick not yet counted into spawnedCount: latch them so desiredCreeps never
    // re-requests their slot, even across the tick boundary where they eventually die. Capped at `wanted`
    // so a same-tick overshoot never pushes the count past the quota.
    const newlySpawned = Math.min(owned.length, wanted) - this.state.spawnedCount;
    if (newlySpawned > 0) {
      return [{ kind: "recordSingleTargetSpawn", room: colony.name, opKind: this.kind, target: this.targetRoom, by: newlySpawned }];
    }

    // Every slot used already, and now nothing's left alive: the job is done either way.
    if (this.state.spawnedCount >= wanted && owned.length === 0) {
      return [{ kind: "endSingleTargetOp", room: colony.name, opKind: this.kind, target: this.targetRoom }];
    }

    return [];
  }
}
