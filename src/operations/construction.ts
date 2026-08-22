// Building owns the construction workforce: builders that service outstanding sites. Demand only, pure.

import { countPart } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { roleDef } from "../behaviors/roles";
import { roomLinearDistance } from "../lib/roomName";
import { remoteMinedIncome } from "../logistics/fleet";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation, type RoleTarget } from "./operation";

const config = {
  // One WORK part per this much outstanding work — headcount falls out of dividing by a body's WORK
  // count, not from a fixed progress-per-creep figure. Uncapped in WORK, but never more than
  // maxBuilders creeps: a handful of well-bodied builders beat a swarm of small ones once storage exists.
  progressPerWork: 1_000,
  maxBuilders: 6,

  // build() costs 5 energy/tick per WORK part (BUILD_POWER = 5), so a room's sustainable build
  // throughput is income / 5 WORK. Income here is the source-regen ceiling (sourceRegenPerTick shared
  // with mining.ts/logistics.ts): a room can't out-harvest its sources. Without storage this is the
  // real limit — over-spending just drains standing energy the haulers never refill. Builders win the
  // energy competition over upgraders (upgrading throttles to the remainder), so the whole income can
  // back building while a backlog exists.
  buildEnergyPerWork: 5,
  sourceRegenPerTick: 10,
  // Remote sources add hauling/upkeep overhead local sources don't pay, so only a fraction of what
  // they're actually yielding right now (see remoteMinedIncome — staffed sources only, already
  // clamped to their own regen cap) counts toward the shared build/upgrade budget.
  remoteIncomeShare: 0.5
} as const;

/**
 * Steady-state harvest ceiling: local sources can't be out-mined, so their share tops out at regen per
 * source. Remote sources add whatever they're actually yielding right now, discounted by
 * remoteIncomeShare — the rest is spoken for by the haul/upkeep cost of running them.
 */
export function incomePerTick(colony: ColonySnapshot): number {
  const local = colony.sources.length * config.sourceRegenPerTick;
  const miners = colony.creeps.filter(c => c.role === "miner");
  const remote = remoteMinedIncome(miners, colony) * config.remoteIncomeShare;
  return local + remote;
}

/** Sustainable build WORK the room's income can feed: income / 5 e/t-per-WORK, floored. */
export function sustainableBuildWork(colony: ColonySnapshot): number {
  return Math.floor(incomePerTick(colony) / config.buildEnergyPerWork);
}

function builderBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// Colony-wide outstanding progress: home-room sites plus any remote room's (siteSummary/remoteConstructionProgress
// are vision-independent-for-siteSummary-but-not-for-progress; a remote room with no vision this tick still shows
// up in siteSummary, just without a progress figure until a creep is standing in it again). Builders dispatch off
// siteSummary already (see buildTargetRoomIntents below), so demand has to count the same backlog or a remote-only
// backlog spawns nobody to go work it.
function totalConstructionProgress(colony: ColonySnapshot): number {
  return colony.constructionProgress + colony.remoteConstructionProgress;
}

// WORK needed to clear outstanding progress, translated into a creep headcount against the current
// body's WORK-per-creep, then capped at maxBuilders — never a raw headcount off progress directly.
//
// Pre-storage the WORK is also capped at what income can sustainably feed (income / 5): without a
// buffer to draw down, extra builders just out-spend the haulers and stall on empty. With storage the
// cap lifts — a build blitz can spend the buffer down and refill afterwards, so the backlog drives it.
function wantedBuilders(colony: ColonySnapshot): number {
  const totalProgress = totalConstructionProgress(colony);
  if (totalProgress <= 0) return 0;
  let wantedWork = Math.ceil(totalProgress / config.progressPerWork);
  if (colony.storageEnergy <= 0) {
    wantedWork = Math.min(wantedWork, Math.max(1, sustainableBuildWork(colony)));
  }
  const bodies = Math.ceil(wantedWork / builderBodyWork(colony));
  return Math.min(config.maxBuilders, bodies);
}

// A remote room currently unsafe/off-limits to work in: hostile presence, owned by another player, or a
// controller reservation held by ANYONE else (invader core or player alike — unlike Reservation's own
// gate, which deliberately lets a claimer contest an Invader's reservation, a builder has no way to
// contest either kind and must not be walked into either). Mining's own harvest gate already stops miners
// the same way (source.danger > 0 || source.ownedBy !== undefined || source.reservedBy !== undefined, see
// mining.ts), so a site there would never get worked anyway — this just stops Building from
// claiming/placing/dispatching into a room that can't be built efficiently.
function unsafeRemoteRooms(colony: ColonySnapshot): Set<string> {
  const out = new Set<string>();
  for (const s of colony.remoteSources) {
    if (s.danger > 0 || s.ownedBy !== undefined || s.reservedBy !== undefined) out.add(s.room);
  }
  return out;
}

// Every room this colony currently owns a construction site in, nearest first — siteSummary is
// vision-independent (Game.constructionSites), so a remote room's backlog counts even without a creep
// standing in it right now. roomLinearDistance (pure Chebyshev, no Game.map) is the same cheap ranking
// pickRemotes/scoutCandidatesAround use for a first-pass distance estimate; a builder crossing rooms
// doesn't need a real pathed distance the way remote staffing economics do.
function roomsWithSites(colony: ColonySnapshot): string[] {
  const unsafe = unsafeRemoteRooms(colony);
  const rooms = new Set(colony.siteSummary.map(s => s.room).filter(r => !unsafe.has(r)));
  return [...rooms].sort((a, b) => roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b));
}

// Reassign only a builder whose current room has run dry — keeps every other builder's assignment
// stable tick to tick instead of re-ranking the whole cohort (and thrashing) every time any room's
// backlog changes. A builder with no candidate room at all (nothing left anywhere) simply keeps
// whatever it had; the role's moveToRoom step no-ops until Building has somewhere to send it again.
function buildTargetRoomIntents(colony: ColonySnapshot): Intent[] {
  const candidates = roomsWithSites(colony);
  if (candidates.length === 0) return [];
  const out: Intent[] = [];
  for (const creep of colony.creeps) {
    if (creep.role !== "builder") continue;
    if (creep.memory.buildTargetRoom && candidates.includes(creep.memory.buildTargetRoom)) continue;
    out.push({ kind: "setBuildTargetRoom", creep: creep.id, room: candidates[0] });
  }
  return out;
}

export class Building extends Operation {
  public readonly kind = "building";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "builder", wantedBuilders(colony), roleDef("builder")!.priority);
  }

  /** Report the true builder target (0 once construction is done), so census shows any surplus as `N/0`. */
  public override roleTargets(colony: ColonySnapshot): RoleTarget[] {
    return [{ role: "builder", target: wantedBuilders(colony) }];
  }

  /** Keeps every live builder's cross-room assignment pointed at a room with outstanding sites. */
  public override intents(colony: ColonySnapshot): Intent[] {
    return buildTargetRoomIntents(colony);
  }
}
