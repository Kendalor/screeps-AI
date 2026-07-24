// An operation is a capability that owns everything it needs — which creeps, which structures, at
// which moment, given colony state. Mining is the proof: miners, their haulers, their containers.
// A class (amending ADR 0005 stage 1's "factories, not classes") bundles one capability's logic.

import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { PlacedStructure } from "../layouts/stamp";
import type { RoleName } from "../memory/schema";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { fillTo, opName, type CreepRequest } from "../spawn/request";

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
   * Demand — arbitrated by planBuilding, which merges, orders and emits `placeSite`. `planned` is
   * everything intended but not built: layout plus earlier operations' claims this poll. Must path
   * against `[...colony.structures, ...planned]`, not built alone, or a derived position shifts the
   * moment that structure goes up — and a sibling's planned road gets reused instead of duplicated.
   */
  public structures(_colony: ColonySnapshot, _planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    return [];
  }

  /**
   * Direct action, not arbitrated — runs every tick (tier 1). Per-tick work (link transfers, lab
   * reactions, tower assist) lives here; an operation gates its own periodic work via `colony.tick`
   * and returns nothing rather than re-emitting an identical write.
   */
  public intents(_colony: ColonySnapshot): Intent[] {
    return [];
  }
}
