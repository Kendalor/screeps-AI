// An operation is a capability that owns everything it needs — which creeps, which structures, at
// which moment, given colony state. Mining is the proof: miners, their haulers, their containers.
// A class (amending ADR 0005 stage 1's "factories, not classes") bundles one capability's logic.

import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { PlacedStructure } from "../construction/stamp";
import type { FindPath } from "../construction/planner";
import type { RoleName } from "../memory/schema";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { fillTo, opName, type CreepRequest } from "../spawn/request";

/**
 * One role's honest staffing target for metrics: how many this operation wants right now, independent
 * of how many are alive. Distinct from `desiredCreeps`, which reports only the deficit (never negative),
 * so an over-staffed role — target below the live count — is invisible there. Census uses this to show
 * `current/target`, e.g. 5 builders alive with nothing left to build reads `5/0`, not `5/5`.
 */
export interface RoleTarget {
  role: RoleName;
  target: number;
}

/**
 * Stateless per-tick value, constructed fresh every tick — `room` is the only field. No mutable
 * fields or persisted `data`: ownership is derived fresh from the snapshot, not stored/reconciled.
 * Methods take `ColonySnapshot`, never `Colony`, so operations can never reach and call siblings.
 */
export abstract class Operation {
  abstract readonly kind: string;

  public constructor(public readonly room: string) {}

  /** `kind` builds `name`; it never looks up another operation — no parent/child links. */
  public get name(): string {
    return opName(this.kind, this.room);
  }

  /**
   * This operation's live creeps of a role. `memory.op` is the ownership stamp that keeps two
   * operations of the same kind (home Mining + a RemoteMining) from double-counting each other's
   * creeps. A creep with no `op` (predates stage 2) is ownable by any matcher, not ignored.
   */
  protected owned(colony: ColonySnapshot, role: RoleName): readonly SnapCreep[] {
    return colony.creeps.filter(c => c.role === role && (c.memory.op === undefined || c.memory.op === this.name));
  }

  /** Demand — arbitrated by planSpawning, which sorts by priority, budgets and emits `spawn`. */
  public desiredCreeps(_colony: ColonySnapshot): CreepRequest[] {
    return [];
  }

  /**
   * The honest per-role target for metrics (see `RoleTarget`). The default reconstructs today's census
   * denominator — target = owned + still-requested — which is correct for any operation that can't
   * over-staff (a role at or above its target simply emits no requests, so target = owned). Operations
   * whose target can drop *below* the live count — Building once sites finish, Upgrading as energy
   * falls — override this to report the true target so census can show the surplus (e.g. `5/0`).
   *
   * `requests` is the colony's already-computed desiredCreeps() output for every operation (see
   * Colony.requests(), which caches it), filtered here to this operation's own slice via
   * memory.op — the same ownership stamp `owned()` above uses. Reusing it instead of calling
   * this.desiredCreeps(colony) again avoids a second full pass over every operation's demand purely to
   * recompute a number the caller already had; the ownership filter makes it exactly equivalent.
   */
  public roleTargets(colony: ColonySnapshot, requests: readonly CreepRequest[] = this.desiredCreeps(colony)): RoleTarget[] {
    const by: Partial<Record<RoleName, number>> = {};
    for (const r of requests) {
      if (r.memory.op !== undefined && r.memory.op !== this.name) continue;
      const role = r.memory.role;
      by[role] = (by[role] ?? 0) + 1;
    }
    // owned + requested, per role touched by either — the deficit reported by desiredCreeps plus what's alive.
    const roles = new Set<RoleName>(Object.keys(by) as RoleName[]);
    for (const c of colony.creeps) if (c.memory.op === undefined || c.memory.op === this.name) roles.add(c.role);
    return [...roles].map(role => ({ role, target: this.owned(colony, role).length + (by[role] ?? 0) }));
  }

  /**
   * Plain-count quota shared by Building, Upgrading and Scouting: size `role`'s body off the role
   * table and fill the gap between `wanted` and what's owned. Not used by Mining — its deficit is
   * per-source WORK, not a flat headcount.
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
   * Demand — arbitrated by planBuilding, which merges, orders and emits `placeSite`. `findPath` is the
   * planner's own pathing seam (construction/planner.ts): it already routes against terrain, the bunker
   * layout, and every earlier operation's resolved claims this poll, so a derived position never shifts
   * once that structure goes up, and a sibling's claimed road is reused instead of duplicated. Return raw
   * candidate claims — dedup/type-precedence is no longer this method's concern (the planner's own
   * `consolidate` step owns it after every operation's turn).
   */
  public structures(_colony: ColonySnapshot, _findPath: FindPath): PlacedStructure[] {
    return [];
  }

  /**
   * Direct action, not arbitrated — runs every tick (tier 1). Per-tick work (link transfers, lab
   * reactions, tower assist) lives here; an operation gates its own periodic work via `colony.tick`
   * and returns nothing rather than re-emitting an identical write.
   *
   * `colonyRequestParts` is the colony-wide outstanding-request body-part total — every operation's
   * `desiredCreeps` summed, the same figure `collectMetrics` uses for the spawn-load panel. Computed
   * once by the orchestrator (`Colony`/`runOperations`), not fetched sideways: an operation still can't
   * reach a sibling directly, it's just handed the one aggregate number a sibling-blind gate (Mining's
   * spawn-load ceiling) needs to read the same load the panel shows instead of undercounting its own
   * slice of it. Most operations have no use for it and ignore the parameter.
   */
  public intents(_colony: ColonySnapshot, _colonyRequestParts: number = 0): Intent[] {
    return [];
  }
}
