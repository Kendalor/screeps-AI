// An operation is a capability that owns everything that capability needs — which creeps, which
// structures, at which moment, given colony state. Mining is the proof: it owns miners, the haulers
// that carry what miners produce, and the per-source containers they drop into.
//
// A class, deliberately, amending ADR 0005 stage 1's "factories, not classes": a class bundles one
// capability's logic and gives it an owner. The existing factories (colony(), empire()) stay as they are.

import type { Intent } from "../intents/types";
import type { PlacedStructure } from "../layouts/stamp";
import type { ColonySnapshot } from "../snapshot/types";
import { opName, type CreepRequest } from "../spawn/request";

/**
 * Operations are stateless per-tick values, constructed fresh every tick. The only field is
 * `room`. **No mutable fields, no cached derivations, no persisted `data`** — that is not style,
 * it preserves stage 2's identity mechanism: ownership is derived fresh from the snapshot each tick
 * instead of stored and reconciled, so there is nothing to validate and nothing that can drift.
 *
 * Legacy is the cautionary tale. `Operation.data.creeps` was a persisted ledger, which forced
 * `validateCreeps()`, which forced `toMemory()`/`loadOperationList()` every tick, which forced the
 * `pause`/`didRun` machinery. None of it is ported.
 *
 * Methods take `ColonySnapshot`, never `Colony`: the dependency stays one-directional — a colony
 * owns operations, operations read snapshots, operations never see the wrapper. An operation that
 * took `Colony` could reach `colony.operations` and call its siblings, and that cycle is forbidden.
 * Taking the snapshot makes it a compile error rather than a convention, and it is the testability
 * requirement discharged: `new Mining("W1N1").desiredCreeps(colonySnap({...}))` needs no Game mock.
 */
export abstract class Operation {
  abstract readonly kind: string;

  public constructor(public readonly room: string) {}

  /**
   * `kind` exists to build `name`; it does not look up. No operation may find another — no
   * getOperationsOfType, no parent/child links. Legacy shows where lookup ends: MinerOperation's
   * constructor threw if it could not find its parent, and getMiningOperation() lazily *created* the
   * missing operation and recursed, mutating the operation list while it was being iterated.
   *
   * Merging happens only in an arbiter, which sees every operation's output at once.
   */
  public get name(): string {
    return opName(this.kind, this.room);
  }

  /** Demand — arbitrated by planSpawning, which sorts by priority, budgets and emits `spawn`. */
  public desiredCreeps(_colony: ColonySnapshot): CreepRequest[] {
    return [];
  }

  /**
   * Demand — arbitrated by planBuilding, which merges, orders and emits `placeSite`.
   *
   * `planned` is everything intended but not yet built: the room's layout, plus the claims of every
   * operation polled before this one. An operation that paths (a road to its container, a route to a
   * remote) **must** path against `[...colony.structures, ...planned]` rather than built structures
   * alone, for two reasons:
   *
   *  - a path computed over built-only tiles runs through ground the layout will later occupy, so
   *    the derived position moves the moment that structure goes up; and
   *  - a sibling's road is in `planned` at ROAD_COST, so A* reuses it instead of laying a second
   *    road one tile over. Two operations heading to nearby targets converge onto one route.
   *
   * That second property is why planBuilding polls **sequentially**, accumulating as it goes:
   * operation order in `operationsFor()` decides who paths freely and who bends toward existing
   * plans. Nothing here knows what produced `planned` — a bunker stamp today, a per-room computed
   * layout later.
   */
  public structures(_colony: ColonySnapshot, _planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    return [];
  }

  /**
   * Direct action, not arbitrated — executed as returned. The escape hatch for work that has no
   * arbiter. An operation never constructs a `spawn` or `placeSite` intent itself: those are demand,
   * and demand is plain data an arbiter decides on.
   *
   * **Runs every tick** (tier 1). Per-tick capabilities live here — link transfers, lab reactions,
   * tower assist — and none of them survive being sampled every 50th tick. An operation whose work
   * is genuinely periodic gates *itself*, using `colony.tick`; an operation whose intent is a
   * no-op right now returns nothing rather than re-emitting an identical write. Both are the
   * operation's decision, because only it knows which of its intents are idempotent.
   */
  public intents(_colony: ColonySnapshot): Intent[] {
    return [];
  }
}
