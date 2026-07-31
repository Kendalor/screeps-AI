// Logistics owns the transport-creep headcount and per-tick task assignment for the provider/consumer
// graph in src/logistics/. It is the colony's sole transport mechanism — Mining no longer spawns
// haulers (see docs/logistics-plan.md for the rollout and the A/B that settled it) — so sizing below
// covers the whole load: source->spawn/extension plus controller-container/tower top-off. Sizing is
// throughput-based (income x round trip), since a flat quota can't carry the whole colony's transport
// load.
//
// Priority is transport.ts's flat roleDef() number (100, tied with bootstrap/supply) — not a
// live-count interleave. An earlier version staggered transport's rank against live miner/transport
// count to avoid miners monopolising every spawn slot, but that only works if both operations agree
// on the exact same live-count index at the exact same tick, which proved fragile in practice
// (miners kept winning every slot regardless). Simpler and correct: desiredCreeps here only ever
// returns a request once a provider has energy to move — real energy already sitting on the
// ground/in a container — so a transport request can never exist before the first miner has produced
// something. Once it does exist, it should win the very next spawn slot outright. The gate keys off
// providers only, NOT the live consumers() list, whose spawnSystem entry blinks out at a full spawn.

import { orderBody } from "../spawn/body";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../layouts/Base_2.json";
import type { GoalLayout } from "../layouts/sync";
import { planLogistics } from "../logistics";
import { providers } from "../logistics/graph";
import { harvestIncome, haulDistance, wantedTransportHeadcount } from "../logistics/fleet";
import { planLinkTransfers } from "../logistics/links";
import { bodyContext } from "../spawn/bodyContext";
import type { ColonySnapshot } from "../snapshot/types";
import { fillTo, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";
import { roleDef } from "../behaviors/roles";

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
  wantedStewards: 1 // one is enough — it never leaves the anchor tile, so there's no throughput case for a second
} as const;

export class Logistics extends Operation {
  public readonly kind = "logistics";

  // No provider or consumer yet (e.g. a fresh RCL1 colony with no containers/drops/spawn deficit)
  // means nothing for a transport creep to do — asking anyway would outrank upgrader for a spawn slot
  // on a job that doesn't exist, the same silent-stall shape Supply avoids by gating on storageEnergy.
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < config.minTransportEnergy) return [];
    // Gate on a provider having energy to move — NOT on consumers() being non-empty this tick. The
    // spawn/extension system is the always-present structural sink (energyCapacity > 0), but its
    // consumers() entry is (capacity - available), which momentarily hits 0 at a full spawn. Gating on
    // the live consumer list there made the transport request vanish exactly when the spawn finally
    // had the energy to build it — a lower-priority miner spawned instead, drained the spawn, and the
    // request reappeared next tick (an oscillation that never spawned transport). A provider with
    // energy plus a spawn system to feed is real, standing work.
    if (providers(colony).length === 0) return [];

    // Nothing alive yet: size the first transport off base spawn capacity (300, always affordable),
    // not full energyCapacity — otherwise the room stalls waiting for the extensions to fill, which
    // is exactly what a transport creep is needed for in the first place. Once one is alive, size
    // subsequent ones off full capacity.
    const energyForBody = this.owned(colony, "transport").length === 0 ? config.bootstrapEnergy : colony.energyCapacity;
    const body = orderBody(roleDef("transport")?.body(energyForBody, bodyContext(colony)) ?? []);
    const wanted = this.wantedTransport(colony, energyForBody);
    const transport = fillTo(wanted, this.owned(colony, "transport").length, body, roleDef("transport")!.priority, {
      role: "transport",
      home: colony.name,
      op: this.name
    });
    return [...transport, ...this.desiredStewards(colony)];
  }

  // A steward only earns its keep once storage exists — before that there's no storage/terminal/link
  // triangle to referee, just the same pre-storage economy transport already covers alone.
  private desiredStewards(colony: ColonySnapshot): CreepRequest[] {
    if (!colony.storageId) return [];
    return this.fillRole(colony, "steward", config.wantedStewards, roleDef("steward")!.priority);
  }

  /** How many transport creeps current income warrants: steady-state pile, capped. */
  private wantedTransport(colony: ColonySnapshot, energyForBody: number): number {
    // Logistics doesn't own miners (Mining does) — read every miner in the colony, not this.owned(),
    // since there's no "logistics:room" stamp on a miner to filter by.
    const miners = colony.creeps.filter(c => c.role === "miner");
    const income = harvestIncome(miners, colony, config);
    const distance = haulDistance(miners, colony, config);
    return wantedTransportHeadcount(income, distance, energyForBody, config);
  }

  /**
   * Direct action, not arbitrated: runs planLogistics once per tick and emits one assignment intent per
   * idle creep, plus this tick's link-network transfers (see logistics/links.ts) — links are instant and
   * creep-free, so they're fired here rather than through the transport allocator.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const plan = planLogistics(colony);
    const assignments: Intent[] = Object.entries(plan.assignments).map(([creep, task]) => ({
      kind: "assignLogisticsTask",
      creep: creep as Id<Creep>,
      task
    }));
    return [...assignments, ...planLinkTransfers(colony), ...this.recordAnchorLink(colony)];
  }

  /**
   * Persists the anchor/storage link's id once built — the equivalent of Mining's recordSourceSpot, for
   * the one link the bunker goal layout places directly (a fixed anchor-relative offset, unlike the
   * controller link's per-room pathed position — see operations/upgrading.ts's own recording for that
   * one). Checked every tick until recorded; cheap (one array find) and execute.ts's write is idempotent.
   */
  private recordAnchorLink(colony: ColonySnapshot): Intent[] {
    if (colony.linkNetwork.storage) return []; // already recorded; only ever adds an id
    if (!colony.anchor) return [];

    const placement = GOAL.placements.find(p => p.type === "link");
    if (!placement) return [];
    const pos = { x: placement.x + colony.anchor.x, y: placement.y + colony.anchor.y };

    const link = colony.links.find(l => l.x === pos.x && l.y === pos.y);
    if (!link) return [];

    return [{ kind: "recordLinkNetwork", room: colony.name, storage: link.id }];
  }
}
