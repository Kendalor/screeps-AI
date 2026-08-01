// One owned room: its snapshot, operations, and colony-scoped capabilities. Rebuilt fresh every tick.
// Spawning is NOT here — spawn routing is cross-colony, owned by the Empire (see empire/spawning.ts).

import type { Intent } from "../intents/types";
import { Colonize } from "../operations/colonize";
import { operationsFor, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { claimsOf, planBuilding, repurposeIdleBuilders, wantedStructures } from "./building";
import { collectMetrics } from "./metrics";
import { visualize } from "./metricsVisual";

// Colonize isn't in operationsFor() (no colony gets it by default — see operations/colonize.ts's
// header), but once a colonizer/settler for some target exists, that target's ongoing demand (settler
// replacement, in particular) must still flow through the normal per-tick requests()/arbiter pipeline
// like every other operation's, not stay a one-shot bypass forever. Derived straight from the colony's
// own live creeps rather than a persisted memory field, matching the "no ColonyMemory field yet" choice
// in colonize.ts — a target with zero colonizer/settler creeps left simply stops being colonized.
function activeColonizeTargets(snapshot: ColonySnapshot): string[] {
  const targets = new Set<string>();
  for (const c of snapshot.creeps) {
    if ((c.role === "colonizer" || c.role === "settler") && c.memory.targetRoom) targets.add(c.memory.targetRoom);
  }
  return [...targets];
}

export class Colony {
  public readonly operations: Operation[];

  // Colony is reconstructed fresh every tick (see operationsFor above), so a plain instance field is
  // exactly the right cache scope: no fingerprint/invalidation needed, it just can't outlive the tick
  // that computed it. requests() is called 2-3x/tick per colony as-is — once by the spawn arbiter
  // (empire/spawning.ts), again by metrics() below, and a third time indirectly for every operation
  // that doesn't override roleTargets() (its default implementation calls desiredCreeps() itself) —
  // all against the same unchanged snapshot, so every call after the first was pure waste.
  private cachedRequests: CreepRequest[] | undefined;

  // `allSnapshots`: every colony's snapshot this tick, so an active Colonize target that has itself
  // become a real Colony (controller claimed) can be looked up for its own energyCapacity — see
  // Colonize's targetEnergyCapacity doc for why that lookup can't happen inside Colonize/Colony
  // themselves (neither has sibling-colony visibility; only the Empire constructing all of them does).
  // Optional and defaulted to `[]` only so existing single-Colony construction (tests, etc.) keeps
  // working without threading the full list through everywhere; Empire always passes the real one.
  public constructor(public readonly snapshot: ColonySnapshot, allSnapshots: readonly ColonySnapshot[] = []) {
    const targetCapacity = new Map(allSnapshots.map(s => [s.name, s.energyCapacity]));
    this.operations = [
      ...operationsFor(snapshot.name),
      ...activeColonizeTargets(snapshot).map(t => new Colonize(snapshot.name, t, targetCapacity.get(t)))
    ];
  }

  public get name(): string {
    return this.snapshot.name;
  }

  /**
   * Minerals this colony can actually mine today — its own room's mineral, if any. Dummy/minimal on
   * purpose: only an owned room's own mineral is mineable until keeper-room mining exists (see
   * ScoutInfo.mineral for the scouting-only view of a candidate/remote room's mineral). Extend this once
   * that capability is built, rather than widening the empire-wide picker's assumptions ahead of it.
   */
  public getMinerals(): MineralConstant[] {
    return this.snapshot.mineral ? [this.snapshot.mineral] : [];
  }

  /** This colony's spawn demand; the empire arbiter sorts and routes across all colonies. Not sorted here. */
  public requests(): CreepRequest[] {
    return (this.cachedRequests ??= this.operations.flatMap(op => op.desiredCreeps(this.snapshot)));
  }

  /**
   * Colony-wide outstanding-request body-part total — the same figure the metrics panel's spawn `load`
   * numerator uses (see `collectMetrics`), computed once here so `intents()` can hand it to operations
   * that need to gate against real total load rather than their own slice of it.
   */
  public requestParts(): number {
    return this.requests().reduce((sum, r) => sum + r.body.length, 0);
  }

  /** The construction arbiter for this colony. */
  public building(): Intent[] {
    return planBuilding(this.snapshot, this.operations);
  }

  /**
   * Repurposes builders left idle once construction is finished — to repairers while anything is decaying,
   * else upgraders. Runs every tick (unlike building(), which is throttled) so a builder converts promptly
   * rather than drop-mining for up to an interval before the next placement pass. Reuses building()'s own
   * operation claims so the "is construction finished" check can't disagree with what would be placed.
   */
  public maintainWorkforce(): Intent[] {
    return repurposeIdleBuilders(this.snapshot, claimsOf(this.snapshot, this.operations));
  }

  /**
   * Collects metrics and returns the roomVisual intent that paints the panel; the only stateful
   * capability (harvest-rate window in Memory). `cpu` is last tick's empire-wide Memory.stats.cpu
   * breakdown — pass it for exactly one colony per tick (the caller picks) so the block isn't repeated
   * on every room's panel.
   */
  public metrics(cpu?: Readonly<Record<string, number>>): Intent[] {
    const mem = (Memory.metrics[this.name] ??= { harvestSamples: [] });
    // Ungated (throttleGroups: false): the panel wants the full plan across every remote source group,
    // not just the one building() is currently placing — otherwise a finished group's structures would
    // count as built with no target left to compare against.
    const targeted = wantedStructures(this.snapshot, claimsOf(this.snapshot, this.operations), false);
    const requests = this.requests();
    const report = collectMetrics(
      this.snapshot,
      requests,
      this.operations.map(op => op.name),
      targeted,
      mem,
      // Passing the already-computed requests through so roleTargets' default doesn't call
      // desiredCreeps() a second time — see the comment on Operation.roleTargets.
      this.operations.flatMap(op => op.roleTargets(this.snapshot, requests)),
      Memory.debugMetrics ?? false
    );
    return [visualize(report, cpu)];
  }
}

export function colony(snapshot: ColonySnapshot, allSnapshots: readonly ColonySnapshot[] = []): Colony {
  return new Colony(snapshot, allSnapshots);
}
