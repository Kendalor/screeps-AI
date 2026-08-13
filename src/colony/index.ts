// One owned room: its snapshot, operations, and colony-scoped capabilities. Rebuilt fresh every tick.
// Spawning is NOT here — spawn routing is cross-colony, owned by the Empire (see empire/spawning.ts).

import type { Intent } from "../intents/types";
import { Attack } from "../operations/attack";
import { Colonize } from "../operations/colonize";
import { Drain } from "../operations/drain";
import { Parade } from "../operations/parade";
import { operationsFor, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { log } from "../lib/log";
import { claimsOf, planBuilding, repurposeIdleBuilders, wantedStructures } from "./building";
import { collectMetrics } from "./metrics";
import { visualize } from "./metricsVisual";

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
    // Same lookup as targetCapacity above, for Colonize's earlier "spawn built" success signal — see
    // Colonize's targetSpawnBuilt doc.
    const targetSpawnBuilt = new Map(allSnapshots.map(s => [s.name, s.spawns.length > 0]));
    // Every OTHER colony's currently-selected remote source ids, so Mining's pickRemotes never converges
    // two colonies onto the same source (see Mining's constructor doc). Read off remoteSources (the
    // already-joined live view), not ColonyMemory.remotes directly, so this stays snapshot-pure like
    // targetCapacity above — no second Memory read outside the snapshot boundary.
    const siblingRemoteSourceIds = new Set(
      allSnapshots.filter(s => s.name !== snapshot.name).flatMap(s => s.remoteSources.map(r => r.id))
    );
    this.operations = [
      ...operationsFor(snapshot.name, siblingRemoteSourceIds),
      // Colonize isn't in operationsFor() (no colony gets it by default — see operations/colonize.ts's
      // header); attached per listed target instead, straight from the durable ColonyMemory.colonizing
      // list (snapshot.colonizing) a flag/auto-pick handoff writes via addColonizeTarget — a plain memory
      // fact, not derived from a live colonizer/settler creep's own memory the way this used to work
      // (fragile: nothing observed a target existed until a creep for it already did, leaving a real gap
      // between "flag resolved" and "operation attached").
      ...snapshot.colonizing.map(t => new Colonize(snapshot.name, t, targetCapacity.get(t), targetSpawnBuilt.get(t))),
      // Attack isn't in operationsFor() either (no colony gets it by default), same reason: attached only
      // while at least one target is listed in ColonyMemory.attacking, a flag handoff's addAttackTarget
      // (see attackFlags.ts). ONE instance pools every listed target behind a shared attacker (see
      // operations/attack.ts's header) — unlike Colonize above, this is not one-instance-per-target.
      // (Defense — the defensive counterpart — needs no equivalent entry here: it's already always
      // attached via operationsFor() above, so a "defend" flag's ColonyMemory.defending targets are
      // pooled straight into that same instance instead of attaching a second one — see defense.ts.)
      ...(snapshot.attacking.length > 0 ? [new Attack(snapshot.name)] : []),
      // Drain isn't in operationsFor() either, same reason: attached only while snapshot.draining
      // (ColonyMemory.draining) is set, a flag handoff's future addDrainTarget equivalent (issue #38, not
      // yet built). Unlike Attack's `attacking` list, `draining` is a scalar — ADR 0006's exactly-one-
      // target-per-colony constraint — so this is unconditionally one-instance-or-none, no pooling.
      ...(snapshot.draining !== undefined ? [new Drain(snapshot.name)] : []),
      // Parade isn't in operationsFor() either, same reason: attached only while snapshot.parading
      // (ColonyMemory.parading) is set, a flag handoff's setParadeTarget (see empire/paradeFlags.ts).
      // Scalar like `draining` — one parade per colony at a time, no pooling.
      ...(snapshot.parading !== undefined ? [new Parade(snapshot.name)] : [])
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
    if (this.cachedRequests) return this.cachedRequests;
    const requests = this.operations.flatMap(op => op.desiredCreeps(this.snapshot));
    log.debugRoom(
      this.name,
      `requests: ${requests.length === 0 ? "none" : requests.map(r => `${r.memory.role}(p${r.priority})`).join(", ")}`
    );
    return (this.cachedRequests = requests);
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
   * breakdown, shown on every colony's panel so it's visible regardless of which room you're viewing.
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
