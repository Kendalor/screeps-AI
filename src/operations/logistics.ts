// Logistics owns the transport-creep headcount and per-tick task assignment for the provider/consumer
// graph in src/logistics/. Additive alongside Mining's hauler and Supply — see docs/logistics-plan.md
// for the full rollout. Step 7: maxHaulers is 0 on this branch, so Logistics now covers the
// source->spawn/extension leg too, not just controller-container/tower top-off — sizing below is
// throughput-based (income x round trip), the same shape as Mining.wantedHaulers, since a flat quota
// can no longer carry the whole colony's transport load.
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

import { countPart, orderBody } from "../spawn/body";
import type { Intent } from "../intents/types";
import { planLogistics } from "../logistics";
import { providers } from "../logistics/graph";
import { harvestIncome, haulDistance } from "../logistics/fleet";
import { bodyContext } from "../spawn/bodyContext";
import type { ColonySnapshot } from "../snapshot/types";
import { fillTo, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";
import { roleDef } from "../behaviors/roles";

const config = {
  sourceRegenPerTick: 10, // shared ceiling with mining.ts — a room can't harvest past source regen
  roomIncomeCap: 20, // room ceiling on harvestable income (two sources) — mirrors mining.ts
  energyPerCarry: 50, // one CARRY part
  carryMargin: 1.1, // over-provision required carry by 10%, same margin mining.ts uses for haulers
  defaultHaulDistance: 10, // fallback before an anchor is known
  maxTransport: 6, // same measured ceiling mining.ts caps haulers at — more doesn't clear backlog faster
  minTransportEnergy: 150 // one CARRY,CARRY,MOVE set — cheapest useful body
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

    const body = orderBody(roleDef("transport")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const wanted = this.wantedTransport(colony, body);
    return fillTo(wanted, this.owned(colony, "transport").length, body, roleDef("transport")!.priority, {
      role: "transport",
      home: colony.name,
      op: this.name
    });
  }

  /** How many transport creeps current income warrants: steady-state pile, capped — same shape as Mining.wantedHaulers. */
  private wantedTransport(colony: ColonySnapshot, body: BodyPartConstant[]): number {
    // Logistics doesn't own miners (Mining does) — read every miner in the colony, not this.owned(),
    // since there's no "logistics:room" stamp on a miner to filter by.
    const miners = colony.creeps.filter(c => c.role === "miner");
    const income = harvestIncome(miners, colony, config);
    if (income <= 0) return 0;

    const roundTrip = 2 * haulDistance(colony, config);
    // Over-provision carry (round up): mirrors mining.ts's haulerCarryMargin reasoning — the exact
    // steady-state figure runs too lean once respawn gaps and en-route drops are accounted for.
    const neededCarry = Math.ceil(income * roundTrip * config.carryMargin);
    const perCreep = Math.max(1, countPart(body, CARRY)) * config.energyPerCarry;

    return Math.min(config.maxTransport, Math.max(1, Math.ceil(neededCarry / perCreep)));
  }

  /** Direct action, not arbitrated: runs planLogistics once per tick and emits one assignment intent per idle creep. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const plan = planLogistics(colony);
    return Object.entries(plan.assignments).map(([creep, task]) => ({
      kind: "assignLogisticsTask",
      creep: creep as Id<Creep>,
      task
    }));
  }
}
