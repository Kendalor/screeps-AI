// Standalone Task/fork/parent chaining primitive (gh #45), shape adapted from bencbartlett/creep-tasks
// (not taken as a dependency — see ADR 0008). Infrastructure only: no LogisticsRequest, registration, or
// ranking here — those land in later issues. fork() makes a new task the creep's current one, demoting
// the prior task to `parent`; on completion, execution walks back to `parent`. The live Task graph exists
// only within a tick; the persisted (cross-tick, CreepMemory) form stores bare target IDs, resolved back
// to live objects only when a task is actually worked.

export type LogisticsTaskKind = "withdraw" | "transfer";

/** A single leg: act on `target` with `resource`, at range 1. */
export interface Task {
  kind: LogisticsTaskKind;
  target: _HasId & { pos: RoomPosition };
  resource: ResourceConstant;
  /** Demoted-to on this task's completion; execution resumes here. Absent means "done, nothing follows". */
  parent?: Task;
  /** Caps a single act() call to exactly this much (via the engine's own withdraw/transfer amount
   * parameter) instead of "as much as fits" — undefined (the default, every existing caller) preserves
   * today's unbounded behavior. A capped task is considered complete after ONE successful act regardless
   * of remaining creep/target capacity (see logisticsTaskRunner.ts's isTaskComplete) — "move exactly this
   * much, once," not an open-ended repeated top-off. Added for boost compound delivery (gh #61 epic,
   * transportRegister.ts's registerBoostLabWantRequest): a Transport creep's CARRY capacity and a boost
   * lab's LAB_MINERAL_CAPACITY are both far larger than a real boost order's actual need, so an uncapped
   * withdraw+deliver pair reliably over-delivers (confirmed live: a lab ended up holding ~3x its real
   * need, e.g. 1150 units for a 390-unit order) — the leftover then sits stranded in the lab, wasted, and
   * skews later scoring since it fills the lab's own free-capacity check without anything to show for it. */
  amount?: number;
}

/** Task, but with every live object reference replaced by a bare ID — Memory's serialization boundary. */
export interface PersistedTask {
  kind: LogisticsTaskKind;
  targetId: Id<_HasId>;
  resource: ResourceConstant;
  parent?: PersistedTask;
  amount?: number;
}

/** Composes `parent` as `child`'s new `.parent`, so working `child` to completion resumes `parent`. */
export function fork(child: Task, parent: Task): Task {
  return { ...child, parent };
}

export function persistTask(task: Task): PersistedTask {
  return {
    kind: task.kind,
    targetId: task.target.id as Id<_HasId>,
    resource: task.resource,
    parent: task.parent ? persistTask(task.parent) : undefined,
    amount: task.amount
  };
}

/**
 * Resolves every leg's targetId back to a live object; this doubles as the isValidTask check (gh #45's
 * AC): null if any leg's target no longer resolves via Game.getObjectById (destroyed, out of vision, …),
 * so a caller getting null already knows the task is dead without a separate validity call.
 */
export function resolveTask(persisted: PersistedTask): Task | null {
  const target = Game.getObjectById(persisted.targetId) as (_HasId & { pos: RoomPosition }) | null;
  if (!target) return null;
  const parent = persisted.parent ? resolveTask(persisted.parent) : undefined;
  if (persisted.parent && !parent) return null;
  return { kind: persisted.kind, target, resource: persisted.resource, parent: parent ?? undefined, amount: persisted.amount };
}
