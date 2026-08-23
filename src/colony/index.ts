// One owned room: its snapshot, operations, and colony-scoped capabilities. Rebuilt fresh every tick.
// Spawning is NOT here — spawn routing is cross-colony, owned by the Empire (see empire/spawning.ts).

import type { Intent } from "../intents/types";
import { Attack } from "../operations/attack";
import { Colonize } from "../operations/colonize";
import { Drain } from "../operations/drain";
import { Parade } from "../operations/parade";
import { operationsFor, SINGLE_TARGET_FLAG_OPERATIONS, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { log } from "../lib/log";
import type { PlacedStructure } from "../construction/stamp";
import { buildingRowsFromPlan, claimsOf, planBuilding, repurposeIdleBuilders } from "../construction/planner";
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

  // Same reasoning as cachedRequests above: claims() is called every tick by maintainWorkforce() AND
  // metrics() (both un-throttled SYSTEMS entries — see kernel/tick.ts), plus again by building() every
  // 100th tick — all against the same unchanged snapshot/operations for the whole tick. Confirmed live
  // (2026-08-13 CPU profiling): claimsOf was firing ~1.75x/colony/tick, each call re-running every
  // operation's structures() (stampLayout + geometry) for no new information.
  private cachedClaims: PlacedStructure[] | undefined;

  /** This tick's operation structure claims (bunker layout + every operation's own structures()). */
  private claims(): PlacedStructure[] {
    return (this.cachedClaims ??= claimsOf(this.snapshot, this.operations));
  }

  // `allSnapshots`: every colony's snapshot this tick, so an active Colonize target that has itself
  // become a real Colony (controller claimed) can be looked up for its own energyCapacity — see
  // Colonize's targetEnergyCapacity doc for why that lookup can't happen inside Colonize/Colony
  // themselves (neither has sibling-colony visibility; only the Empire constructing all of them does).
  // Optional and defaulted to `[]` only so existing single-Colony construction (tests, etc.) keeps
  // working without threading the full list through everywhere; Empire always passes the real one.
  public constructor(public readonly snapshot: ColonySnapshot, allSnapshots: readonly ColonySnapshot[] = []) {
    const targetCapacity = new Map(allSnapshots.map(s => [s.name, s.energyCapacity]));
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
      ...snapshot.colonizing.map(t => new Colonize(snapshot.name, t, targetCapacity.get(t))),
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
      ...(snapshot.parading !== undefined ? [new Parade(snapshot.name)] : []),
      // The whole SingleTargetFlagOperation family (SimpleBaitTower, Demolish, SimpleHeal,
      // AttackController, and any future member — see operations/singleTargetFlagOperation.ts) isn't in
      // operationsFor() either, same reason: attached only per (kind, target) entry actually present in
      // snapshot.singleTargetOps, a flag handoff's setSingleTargetOp (see empire/singleTargetFlags.ts).
      // One generic loop over SINGLE_TARGET_FLAG_OPERATIONS replaces what used to be one hand-spread block
      // per kind here.
      ...SINGLE_TARGET_FLAG_OPERATIONS.flatMap(OpClass =>
        Object.entries(snapshot.singleTargetOps[OpClass.kind] ?? {})
          .filter(([, state]) => state.wanted > 0)
          .map(([target, state]) => new OpClass(snapshot.name, target, state))
      )
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
    return this.snapshot.mineral ? [this.snapshot.mineral.mineralType] : [];
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
   * Deliberately does NOT pass a pre-computed `wanted` — hasOutstandingConstruction's own count-only fast
   * path (src/construction/planner.ts) answers "is anything still missing" far more cheaply than a full
   * wantedStructures call would, and forcing one here just to hand it over would defeat that entirely.
   */
  public maintainWorkforce(): Intent[] {
    return repurposeIdleBuilders(this.snapshot, this.claims());
  }

  /**
   * Collects metrics and returns the roomVisual intent that paints the panel; the only stateful
   * capability (harvest-rate window in Memory). `cpu` is last tick's empire-wide Memory.stats.cpu
   * breakdown, shown on every colony's panel so it's visible regardless of which room you're viewing.
   */
  public metrics(cpu?: Readonly<Record<string, number>>): Intent[] {
    const mem = (Memory.metrics[this.name] ??= { harvestSamples: [] });
    // Read-only + math: building()/planBuilding is the sole owner of construction governance and writes
    // the FINAL, fully-gated plan itself once per its own interval:100 cadence (see
    // ColonyMemory.buildingPlan's own doc) — the metrics panel only ever aggregates that cached plan into
    // per-type counts (buildingRowsFromPlan, a cheap linear pass), the same relationship it already has
    // with hasOutstandingConstruction's own cache. Absent (colony's first tick, or no anchor yet) reads as
    // an empty panel row rather than computing or re-deriving anything itself.
    const buildings = buildingRowsFromPlan(Memory.colonies[this.name]?.buildingPlan ?? []);
    const requests = this.requests();
    const report = collectMetrics(
      this.snapshot,
      requests,
      this.operations.map(op => op.name),
      buildings,
      mem,
      // Passing the already-computed requests through so roleTargets' default doesn't call
      // desiredCreeps() a second time — see the comment on Operation.roleTargets.
      this.operations.flatMap(op => op.roleTargets(this.snapshot, requests)),
      Memory.debugMetrics ?? false
    );
    // Gauges only, mirrored from `report`/`this.snapshot` — no rates computed here, Grafana derives
    // those itself from the raw levels (see StatsMemory.rooms's own doc).
    (Memory.stats.rooms ??= {})[this.name] = {
      energyAvailable: report.energy.available,
      energyCapacity: report.energy.capacity,
      storageEnergy: report.energy.storage,
      spawnLoad: report.spawns.load,
      controllerLevel: report.controller.level,
      controllerProgress: report.controller.progress,
      controllerProgressTotal: report.controller.progressTotal,
      census: Object.fromEntries(report.census.map(c => [c.role, { current: c.current, desired: c.desired }])),
      buildings: Object.fromEntries(report.buildings.map(b => [b.type, { built: b.built, targeted: b.targeted }])),
      numRemotes: new Set(this.snapshot.remoteSources.map(s => s.room)).size
    };
    return [visualize(report, cpu)];
  }
}

export function colony(snapshot: ColonySnapshot, allSnapshots: readonly ColonySnapshot[] = []): Colony {
  return new Colony(snapshot, allSnapshots);
}
