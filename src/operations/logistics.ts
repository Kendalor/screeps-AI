// Logistics owns the transport-creep headcount for the live pool driven, per gh #52, by
// behaviors/transportTaskRunner.ts's LogisticsRequest system (src/logistics/transportRegister.ts) rather
// than this file's own intents() (Transport's assignment no longer flows through a planner here — the old
// graph.ts/allocate.ts/logistics/index.ts pipeline this used to drive is deleted, gh #55). Sizing below
// covers the whole load Transport's new pool actually owns:
// source/mineral output -> controller-container/builder-upgrader-battery/storage, NEVER spawn/extension
// (Supply's exclusive scope). Sizing is throughput-based (income x round trip), since a flat quota can't
// carry the whole colony's transport load.
//
// Priority is transport.ts's flat roleDef() number (100, tied with bootstrap/supply) — not a
// live-count interleave. An earlier version staggered transport's rank against live miner/transport
// count to avoid miners monopolising every spawn slot, but that only works if both operations agree
// on the exact same live-count index at the exact same tick, which proved fragile in practice
// (miners kept winning every slot regardless). Simpler and correct: desiredCreeps here only ever
// returns a request once a provider has energy to move AND the new pool has somewhere to put it (see
// transportPoolHasConsumer's own doc) — real energy already sitting on the ground/in a container, with
// a real consumer for it, so a transport request can never exist before the first miner has produced
// something AND something wants it. Once it does exist, it should win the very next spawn slot outright.

import { orderBody } from "../spawn/body";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../construction/Base_2.json";
import type { GoalLayout } from "../construction/sync";
import { CONTROLLER_CONTAINER_FILL_FLOOR, DROP_WORTHWHILE_FLOOR, UPGRADER_CONTROLLER_RANGE } from "../logistics/transportRegister";
import { harvestIncome, haulDistance, wantedTransportHeadcount } from "../logistics/fleet";
import { planLinkTransfers } from "../logistics/links";
import { bodyContext } from "../spawn/bodyContext";
import type { ColonySnapshot } from "../snapshot/types";
import { fillTo, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";
import { roleDef } from "../behaviors/roles";
import type { SnapCreep } from "../snapshot/types";

const CONTROLLER_CONTAINER_RANGE = 1; // mirrors transportRegister.ts's own constant — Chebyshev range to the controller

/**
 * Whether Transport's NEW live pool (transportRegister.ts) has ANY real consumer to deliver a pickup to
 * right now — a snapshot-pure mirror of that module's registerControllerContainerRequest/
 * registerCreepBatteryRequests/registerStorageSinkRequests scope, since desiredCreeps only has a
 * ColonySnapshot to read (the live pool itself reads Game.* directly — see transportRegister.ts's
 * header). Without this gate, `providers(colony).length > 0` alone (real energy sitting on the ground)
 * was enough to keep requesting more transport creeps even when NOTHING in the new pool could receive
 * it (e.g. a fresh RCL1 colony: no controller container, no storage, no builder/upgrader alive yet,
 * since Supply alone is still catching up) — those creeps spawned, sat idle forever (nowhere to
 * deliver), and — worse — kept outranking upgrader/bootstrap-replacement for every spawn slot at
 * priority 100, stalling the colony's climb to RCL2 entirely (confirmed live during gh #52's own
 * integration testing: controller progress plateaued permanently once transport's dead-weight headcount
 * saturated the spawn queue). Mirrors Supply's own storageEnergy gate (needsHandoff's doc) in spirit:
 * don't ask for a mover with nothing to move things to.
 */
function transportPoolHasConsumer(colony: ColonySnapshot): boolean {
  const controllerContainer = colony.containers.find(c => {
    const dx = c.x - colony.controller.x;
    const dy = c.y - colony.controller.y;
    return Math.max(Math.abs(dx), Math.abs(dy)) <= CONTROLLER_CONTAINER_RANGE;
  });
  if (controllerContainer) {
    const floor = Math.floor(controllerContainer.storeCapacity * CONTROLLER_CONTAINER_FILL_FLOOR);
    if (controllerContainer.storeEnergy < floor) return true;
  }

  if (!colony.storageId) {
    // Pre-storage: builder/upgrader creeps are direct battery sinks (registerCreepBatteryRequests) —
    // mirrors that function's own scope exactly, including its UPGRADER_CONTROLLER_RANGE gate: an
    // upgrader off harvesting or still travelling to the controller isn't a viable delivery target there,
    // so it must not count here either, or this would request transport headcount the real pool can never
    // actually use.
    const hasOpenBattery = colony.creeps.some(c => {
      if (c.role === "builder") return c.storeEnergy < c.storeCapacity;
      if (c.role === "upgrader") {
        const dx = c.x - colony.controller.x;
        const dy = c.y - colony.controller.y;
        const inRange = Math.max(Math.abs(dx), Math.abs(dy)) <= UPGRADER_CONTROLLER_RANGE;
        return inRange && c.storeEnergy < c.storeCapacity;
      }
      return false;
    });
    if (hasOpenBattery) return true;
  } else {
    if (colony.storageEnergy < colony.storageCapacity) return true;
    if (colony.mineral && colony.storageEnergy + colony.storageMineral < colony.storageCapacity) return true;
  }

  return false;
}

/**
 * Whether there's ANY real energy or mineral for transport to move right now — a snapshot-pure gate
 * mirroring the old graph.ts's `providers()` predicate (deleted at gh #55: source containers other than
 * the controller container, dropped piles/tombstones/ruins past the worthwhile floor, remote energy, the
 * mineral container, and storage itself once it has a spawn-system deficit to cover). `desiredCreeps`
 * only has a ColonySnapshot to read, so this stays a pure read over that snapshot rather than a live
 * Game.* registration call — same reasoning as transportPoolHasConsumer's own doc, just the pickup half
 * of the same gate instead of the delivery half. Short-circuits on the first hit; only ever consulted as
 * a boolean (`.length === 0` on the old graph.ts array), so there's no need to build a list here.
 */
function transportPoolHasProvider(colony: ColonySnapshot): boolean {
  for (const c of colony.containers) {
    if (c.storeEnergy <= 0) continue;
    const dx = c.x - colony.controller.x;
    const dy = c.y - colony.controller.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= CONTROLLER_CONTAINER_RANGE) continue; // controller container is a consumer, not a source
    return true;
  }

  if (colony.drops.some(d => d.amount >= DROP_WORTHWHILE_FLOOR)) return true;
  if (colony.tombstones.some(t => t.storeEnergy >= DROP_WORTHWHILE_FLOOR)) return true;
  if (colony.ruins.some(r => r.storeEnergy >= DROP_WORTHWHILE_FLOOR)) return true;
  if (colony.remoteEnergy.some(r => r.amount >= DROP_WORTHWHILE_FLOOR)) return true;

  if (colony.storageId && colony.storageEnergy > 0 && colony.energyCapacity > colony.energyAvailable) return true;

  if (colony.mineral?.containerId && (colony.mineral.containerMineral ?? 0) > 0) return true;

  return false;
}

const GOAL = GOAL_JSON as GoalLayout;

const config = {
  sourceRegenPerTick: 10, // shared ceiling with mining.ts — a room can't harvest past source regen
  roomIncomeCap: 20, // room ceiling on harvestable income (two sources) — mirrors mining.ts
  energyPerCarry: 50, // one CARRY part
  carryMargin: 1.2, // over-provision required carry by 20% — a transporter's task set is larger than a
  // hauler's (source->spawn/ext plus controller/tower top-off), so the plain income x round-trip figure
  // under-counts the true transport load; bump the factor here pending a proper task-aware calculation.
  // Now that maxTransport (below) scales with remote income too, the margin can run leaner — it no
  // longer has to compensate for the cap silently swallowing remote-driven demand.
  defaultHaulDistance: 10, // fallback before an anchor is known
  maxTransport: 12, // raised from mining.ts's old local-only hauler ceiling (6) — remote sources add income/distance the original cap never accounted for
  minTransportEnergy: 150, // one CARRY,CARRY,MOVE set — cheapest useful body
  bootstrapEnergy: 300, // base spawn capacity, always affordable — size the FIRST transport off this
  wantedStewards: 1, // one is enough — it never leaves the anchor tile, so there's no throughput case for a second
  // gh #52's pre-storage transport sink cap (wantedTransport's own doc): a floor so the very first
  // transport creep is never blocked out entirely (there's always the controller-container/ground-pile
  // withdraw side even with zero battery-holders alive yet), and a per-battery-holder multiplier sized
  // generously enough for real throughput (a battery-holder's own trip cadence easily keeps 2 transport
  // creeps' worth of deliveries busy) without reproducing the unbounded income-only blowup.
  minPreStorageTransport: 2,
  preStorageTransportPerBattery: 2
} as const;

// Whether the sole surviving steward is close enough to death that its replacement must already be
// spawning — spawn time is body-length-dependent, so a late request leaves the link triangle
// unrefereed for a gap after it dies. Same shape as supply.ts's needsHandoff.
function needsHandoff(creeps: readonly SnapCreep[], body: BodyPartConstant[]): boolean {
  if (creeps.length !== 1) return false; // one-in, one-out only — quota shortfalls take the branch above
  const left = creeps[0].ticksToLive;
  return left !== undefined && left <= body.length * CREEP_SPAWN_TIME;
}

export class Logistics extends Operation {
  public readonly kind = "logistics";

  // No provider or consumer yet (e.g. a fresh RCL1 colony with no containers/drops/spawn deficit)
  // means nothing for a transport creep to do — asking anyway would outrank upgrader for a spawn slot
  // on a job that doesn't exist, the same silent-stall shape Supply avoids by gating on storageEnergy.
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < config.minTransportEnergy) return [];
    // Gate on a provider having energy to move AND the new pool having a real place to put it
    // (transportPoolHasConsumer — see gh #52's own doc on that function: without the consumer half of
    // this gate, transport creeps kept spawning with nowhere to deliver, permanently starving
    // upgrader/bootstrap-replacement of spawn slots). gh #55: transportPoolHasProvider replaces the old
    // graph.ts's `providers(colony).length === 0` check (graph.ts deleted) with an equivalent
    // snapshot-pure predicate — see that function's own doc.
    if (!transportPoolHasProvider(colony)) return [];
    if (!transportPoolHasConsumer(colony)) return [];

    // Nothing alive yet: size the first transport off base spawn capacity (300, always affordable),
    // not full energyCapacity — otherwise the room stalls waiting for the extensions to fill, which
    // is exactly what a transport creep is needed for in the first place. Once one is alive, size
    // subsequent ones off full capacity. A live supply creep means the room's economy is already
    // established (supply only spawns once energyCapacity clears supply's own minimum, see
    // operations/supply.ts) — that's true even if transport itself momentarily hits 0 (e.g. the
    // sole transport died without a queued handoff), so gate the emergency-cold-start body on
    // supply's presence too, not transport's live count alone. Without this, a mature RCL4+ room
    // whose one transport dies would get a fresh 300-energy replacement instead of one sized off
    // the room's real capacity, permanently undersizing the fleet since headcount math (which
    // assumes a capacity-sized body) then reports that single small creep as sufficient.
    // colony.creeps directly, not this.owned() — owned() filters by op-name ownership (undefined or
    // this operation's own name), meant for dedup between same-kind operations (Mining vs
    // RemoteMining). A live supply creep is stamped op:"supply:<room>", which owned() would reject as
    // not belonging to Logistics — checking role alone across the whole colony is what's needed here.
    const roomIsStale = this.owned(colony, "transport").length === 0 && !colony.creeps.some(c => c.role === "supply");
    const energyForBody = roomIsStale ? config.bootstrapEnergy : colony.energyCapacity;
    const body = orderBody(roleDef("transport")?.body(energyForBody, bodyContext(colony)) ?? []);
    const wanted = this.wantedTransport(colony, energyForBody);
    const transport = fillTo(wanted, this.owned(colony, "transport").length, body, roleDef("transport")!.priority, {
      role: "transport",
      home: colony.name,
      op: this.name
    });
    return [...transport, ...this.desiredStewards(colony)];
  }

  // A steward only earns its keep once storage exists AND the link triangle it's meant to referee is
  // actually there: links don't unlock until RCL5, and even then a single link (typically the first
  // source link) leaves nothing worth rebalancing until a second one completes the loop.
  private desiredStewards(colony: ColonySnapshot): CreepRequest[] {
    if (!colony.storageId) return [];
    if (colony.controllerLevel < 5 || colony.links.length < 2) return [];

    const have = this.owned(colony, "steward");
    const def = roleDef("steward")!;
    const body = orderBody(def.body(colony.energyCapacity, bodyContext(colony)));

    const missing = config.wantedStewards - have.length;
    const requestCount = missing > 0 ? missing : needsHandoff(have, body) ? 1 : 0;
    if (requestCount === 0) return [];

    return Array.from({ length: requestCount }, () => ({
      body: [...body],
      priority: def.priority,
      memory: { role: "steward", home: colony.name, op: this.name },
      targetRoom: colony.name,
      spawnRoom: colony.name
    }));
  }

  /** How many transport creeps current income warrants: steady-state pile, capped. */
  private wantedTransport(colony: ColonySnapshot, energyForBody: number): number {
    // Logistics doesn't own miners (Mining does) — read every miner in the colony, not this.owned(),
    // since there's no "logistics:room" stamp on a miner to filter by.
    const miners = colony.creeps.filter(c => c.role === "miner");
    const income = harvestIncome(miners, colony, config);
    const distance = haulDistance(miners, colony, config);
    const raw = wantedTransportHeadcount(income, distance, energyForBody, config);

    // gh #52 cutover: Transport's new pool (transportRegister.ts) never delivers to spawn/extension
    // (Supply's exclusive scope) — pre-storage, its only deliver-side sinks are the controller
    // container (once built) and builder/upgrader creep batteries (registerCreepBatteryRequests), a
    // much smaller total capacity than the old system's spawn/extension fallback offered. Without a
    // cap here, income-based sizing (identical formula, unchanged) requests far more transport creeps
    // than that small sink set can ever usefully absorb — confirmed live during gh #52's own
    // integration testing: a fresh RCL1 room's income math alone asked for 9 transport creeps against
    // a single upgrader's tiny battery, and those unmet, ever-pending priority-100 requests
    // permanently starved upgrader's own priority-60 request of every spawn slot, stalling the colony
    // completely (the SAME priority tie-up that motivated Supply's own existence over transport
    // directly feeding spawn — see this file's original header comment on that). Once storage exists,
    // its own much larger capacity is the real sink and this cap no longer applies.
    if (colony.storageId) return raw;
    const battery = colony.creeps.filter(c => c.role === "builder" || c.role === "upgrader").length;
    return Math.min(raw, Math.max(config.minPreStorageTransport, battery * config.preStorageTransportPerBattery));
  }

  /**
   * Direct action, not arbitrated: emits this tick's link-network transfers (see logistics/links.ts) —
   * links are instant and creep-free, so they're fired here rather than through a creep allocator — plus
   * the anchor-link recording intent below. Transport (gh #52) and Supply (gh #53) both self-register and
   * self-assign their own tasks directly against Game.* each tick (transportTaskRunner.ts/
   * supplyTaskRunner.ts), so there is nothing left for this operation to plan or assign — the old
   * graph.ts/allocate.ts/logistics/index.ts planLogistics pipeline this operation used to drive is deleted
   * entirely as of gh #55.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    return [...planLinkTransfers(colony), ...this.recordAnchorLink(colony)];
  }

  /**
   * Persists the anchor/storage link's id once built — the equivalent of Mining's recordSourceSpot, for
   * the one link the bunker goal layout places directly (a fixed anchor-relative offset, unlike the
   * controller link's per-room pathed position — see operations/upgrading.ts's own recording for that
   * one). Checked every tick until recorded; cheap (one array find) and execute.ts's write is idempotent.
   */
  private recordAnchorLink(colony: ColonySnapshot): Intent[] {
    // Re-detects rather than trusting the recorded id blindly: if that link was destroyed (combat,
    // manual removal), colony.links no longer contains it and a replacement must be found again — see
    // operations/upgrading.ts's matching fix for the controller link, which hit this exact staleness bug.
    if (colony.linkNetwork.storage && colony.links.some(l => l.id === colony.linkNetwork.storage)) return [];
    if (!colony.anchor) return [];

    const placement = GOAL.placements.find(p => p.type === "link");
    if (!placement) return [];
    const pos = { x: placement.x + colony.anchor.x, y: placement.y + colony.anchor.y };

    const link = colony.links.find(l => l.x === pos.x && l.y === pos.y);
    if (!link) return [];

    return [{ kind: "recordLinkNetwork", room: colony.name, storage: link.id }];
  }
}
