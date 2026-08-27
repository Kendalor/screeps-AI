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
import { roleDef } from "../behaviors/roles";
import { computeBoostNeeds } from "../empire/boostNeeds";
import { aggregateBoostDemand, type CreepBoostDemand } from "../empire/boostDemand";
import { planLabClaims, type BoostContender, type LabClaim } from "../empire/labClaims";
import type { ColonyMemory } from "../memory/schema";
import { collectMetrics } from "./metrics";
import { visualize } from "./metricsVisual";

// The tier every boost order resolves against until a later task threads a real resolved tier through
// from flag-parsing (see docs/boosting-lab-runner-design.md's own note on this gap). T1 is the safe
// placeholder: it demands the least compound and is never wrong in kind, only potentially under-boosted
// compared to whatever tier a future task would have picked. No field on CreepMemory/SnapCreep carries a
// resolved tier today — searched both before choosing this default.
const DEFAULT_BOOST_TIER = 1 as const;

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
   * The LabRunner (gh #61 epic, docs/boosting-lab-runner-design.md sections 2-3): thin wrapper, same shape
   * as building() above — reads live/persisted state, calls Task A's pure planLabClaims, returns Intent[]
   * that persist the result. Two independent halves:
   *
   * (a) One-time lab-identity discovery: once Memory.colonies[this.name].boostLabIds is set, this half
   * never runs again (see ColonyMemory.boostLabIds' own doc for why re-deciding later is deliberately
   * unsupported). Reads live labs off Game.rooms directly (not the snapshot, which carries no lab list) —
   * an unavoidable direct Game.* read, same precedent stewardRegister.ts already sets for out-of-snapshot
   * structure data.
   *
   * (b) Every-call claim reconciliation/allocation: runs only once boostLabIds exists, over every
   * currently-boostable creep this colony owns with a still-pending memory.boosts order.
   */
  public labs(): Intent[] {
    const intents: Intent[] = [];
    const mem: ColonyMemory | undefined = Memory.colonies[this.name];
    let boostLabIds = mem?.boostLabIds;

    if (!boostLabIds) {
      const labs = Game.rooms[this.name]
        ?.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LAB })
        .map(s => s.id as Id<StructureLab>);
      if (labs && labs.length >= 3) {
        const chosen = [...labs].sort().slice(0, 3);
        intents.push({ kind: "setBoostLabIds", room: this.name, labIds: chosen });
        boostLabIds = chosen; // usable this same call for (b) below, though normally not set until next tick
      }
    }

    if (!boostLabIds) return intents; // fewer than 3 labs built yet — nothing to allocate onto

    const existingClaims: LabClaim[] = Object.entries(mem?.boostClaims ?? {}).map(([labId, claim]) => ({
      labId: labId as Id<StructureLab>,
      compound: claim!.compound,
      amount: claim!.amount
    }));

    const contenders: BoostContender[] = [];
    const demands: CreepBoostDemand[] = [];
    for (const creep of this.snapshot.creeps) {
      const pending = creep.memory.boosts;
      if (!pending || pending.length === 0) continue;
      const boostable = roleDef(creep.role)?.boostable ?? [];
      // Only the still-outstanding actions — a creep whose "heal" is already satisfied shouldn't keep
      // demanding lab capacity for it (see this method's own header doc / the spec's own reasoning).
      const stillPending = boostable.filter(action => pending.includes(action));
      if (stillPending.length === 0) continue;
      // The snapshot's own body (live parts only) is exactly what computeBoostNeeds wants; falling back to
      // live Game.creeps only if a future snapshot ever omits body (it doesn't today — SnapCreep.body
      // exists), matching stewardRegister.ts's precedent for reading live Game.* when a snapshot lacks
      // something this capability needs.
      const body = creep.body ?? Game.creeps[creep.name]?.body.map(p => p.type) ?? [];
      const needs = computeBoostNeeds(stillPending, body, DEFAULT_BOOST_TIER);
      // Spawning creeps have no ticksToLive; SnapCreep carries no spawn-progress/remaining-ticks field
      // either, so 0 is used as a documented placeholder meaning "always most urgent" (see this method's
      // header doc) — Task A's planLabClaims sorts contenders ascending by this value.
      const ticksUntilReady = creep.spawning ? 0 : (creep.ticksToLive ?? 0);
      contenders.push({ creepId: creep.id, ticksUntilReady, needs });
      demands.push({ creepId: creep.id, needs });
    }

    const aggregatedDemand = aggregateBoostDemand(demands);
    const claims = planLabClaims(existingClaims, boostLabIds, contenders, aggregatedDemand);
    intents.push({ kind: "setBoostClaims", room: this.name, claims });

    return intents;
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
