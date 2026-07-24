// An operation is a capability that owns everything it needs — which creeps, which structures, at
// which moment, given colony state. Mining is the proof: it owns miners, the haulers that carry
// what miners produce, and the per-source containers they drop into.
//
// A class, deliberately, amending ADR 0005 stage 1's "factories, not classes": a class bundles one
// capability's logic and gives it an owner. The existing factories (colony(), empire()) are unchanged.

import { orderBody } from "../behaviors/body";
import { bodyContext } from "../behaviors/bodyContext";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { PlacedStructure } from "../layouts/stamp";
import type { RoleName } from "../memory/schema";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { fillTo, opName, type CreepRequest } from "../spawn/request";

/**
 * Operations are stateless per-tick values, constructed fresh every tick — `room` is the only
 * field. **No mutable fields, no cached derivations, no persisted `data`**: ownership is derived
 * fresh from the snapshot each tick instead of stored and reconciled, so there is nothing to
 * validate and nothing that can drift. Legacy's `Operation.data.creeps` was a persisted ledger,
 * which forced `validateCreeps()`, `toMemory()`/`loadOperationList()` every tick, and a
 * `pause`/`didRun` machinery — none of it is ported.
 *
 * Methods take `ColonySnapshot`, never `Colony`: the dependency stays one-directional — a colony
 * owns operations, operations read snapshots, operations never see the wrapper. An operation that
 * took `Colony` could reach `colony.operations` and call its siblings, and that cycle is forbidden;
 * taking the snapshot makes it a compile error rather than a convention, and it is also why
 * `new Mining("W1N1").desiredCreeps(colonySnap({...}))` needs no Game mock.
 */
export abstract class Operation {
  abstract readonly kind: string;

  public constructor(public readonly room: string) {}

  /**
   * `kind` exists to build `name`; it does not look up. No operation may find another — no
   * getOperationsOfType, no parent/child links. Legacy's MinerOperation constructor threw if it
   * could not find its parent, and getMiningOperation() lazily *created* the missing one and
   * recursed, mutating the operation list mid-iteration. Merging happens only in an arbiter, which
   * sees every operation's output at once.
   */
  public get name(): string {
    return opName(this.kind, this.room);
  }

  /**
   * This operation's live creeps of a role — the satisfaction-check primitive. Filtering by role
   * alone is a bug the moment two operations of the same kind exist (home Mining plus a RemoteMining
   * both want `miner`): each would count the other's creeps and under-spawn, so `memory.op` is the
   * ownership stamp that tells them apart.
   *
   * A creep with **no** `op` counts as ownable by any matching operation, not ignored: creeps that
   * predate stage 2 (or a newly added operation) carry no `op`, still do the work, and are cleared
   * by attrition rather than migration (PRD §6) — excluding them would make every operation see a
   * bare colony and over-spawn until they died of old age.
   */
  protected owned(colony: ColonySnapshot, role: RoleName): readonly SnapCreep[] {
    return colony.creeps.filter(c => c.role === role && (c.memory.op === undefined || c.memory.op === this.name));
  }

  /** Demand — arbitrated by planSpawning, which sorts by priority, budgets and emits `spawn`. */
  public desiredCreeps(_colony: ColonySnapshot): CreepRequest[] {
    return [];
  }

  /**
   * The plain-count quota shared by Building, Upgrading and Scouting: size `role`'s body off the
   * role table, compare `wanted` against what this operation already owns, and fill the gap at
   * `priority`. Centralised so the role table stays the one place a body formula lives — a requester
   * asking `roleDef` itself risks sizing against the wrong context or forgetting `orderBody`.
   *
   * Not used by Mining: its miner deficit is per-source WORK, not a flat headcount, which is the
   * reason `fillTo` (and this wrapper) exists as a *shared* case rather than the only one.
   */
  protected fillRole(colony: ColonySnapshot, role: RoleName, wanted: number, priority: number): CreepRequest[] {
    const body = orderBody(roleDef(role)?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    return fillTo(wanted, this.owned(colony, role).length, body, priority, {
      role,
      home: colony.name,
      op: this.name
    });
  }

  /**
   * Demand — arbitrated by planBuilding, which merges, orders and emits `placeSite`.
   *
   * `planned` is everything intended but not yet built: the room's layout, plus the claims of every
   * operation polled before this one. An operation that paths (a road to its container, a route to a
   * remote) **must** path against `[...colony.structures, ...planned]` rather than built structures
   * alone: a built-only path runs through ground the layout will later occupy, moving the derived
   * position the moment that structure goes up; and a sibling's road sits in `planned` at
   * ROAD_COST, so A* reuses it instead of laying a second road one tile over.
   *
   * That reuse is why planBuilding polls **sequentially**, accumulating as it goes — operation order
   * in `operationsFor()` decides who paths freely and who bends toward existing plans. Nothing here
   * knows what produced `planned` — a bunker stamp today, a per-room computed layout later.
   */
  public structures(_colony: ColonySnapshot, _planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    return [];
  }

  /**
   * Direct action, not arbitrated — executed as returned; the escape hatch for work with no arbiter.
   * An operation never constructs a `spawn` or `placeSite` intent itself: those are demand, decided
   * on by an arbiter.
   *
   * **Runs every tick** (tier 1). Per-tick capabilities live here — link transfers, lab reactions,
   * tower assist — none of which survive being sampled every 50th tick. An operation whose work is
   * genuinely periodic gates *itself* via `colony.tick`; one whose intent would be a no-op returns
   * nothing rather than re-emitting an identical write — only the operation knows which of its
   * intents are idempotent.
   */
  public intents(_colony: ColonySnapshot): Intent[] {
    return [];
  }
}
