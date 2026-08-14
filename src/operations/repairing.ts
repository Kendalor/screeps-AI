// Repairing owns the dedicated repair workforce: decay no tower reaches — either because the colony
// has no tower yet, or the decayed structure sits beyond a tower's efficient repair range (remote
// infrastructure, or a bunker structure just outside range). Tower-covered decay is Defense's job.
// Decay in a selected remote room is always uncovered — towers only ever live in the home room.

import { roleDef } from "../behaviors/roles";
import { bodyContext } from "../spawn/bodyContext";
import { countPart } from "../spawn/body";
import type { Intent } from "../intents/types";
import { needsRepair } from "../lib/repairable";
import { roomLinearDistance } from "../lib/roomName";
import { coveredByTower } from "./defense";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation, type RoleTarget } from "./operation";

const config = {
  maxRepairers: 3 // hard ceiling — a backlog bigger than this needs the player's attention, not an ever-growing spawn queue
} as const;

function isDecayed(s: SnapStructure): boolean {
  return s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax);
}

function homeUncovered(colony: ColonySnapshot): boolean {
  return colony.structures.some(s => isDecayed(s) && !coveredByTower(colony, s));
}

function uncoveredDecay(colony: ColonySnapshot): SnapStructure[] {
  const home = colony.structures.filter(s => isDecayed(s) && !coveredByTower(colony, s));
  const remote = Object.values(colony.remoteStructures).flatMap(list => (list ?? []).filter(isDecayed));
  return [...home, ...remote];
}

// Missing hits summed across every tower-uncovered decayed structure, colony-wide (home + every remote
// room with vision). One WORK part restores REPAIR_POWER hits/tick over its CREEP_LIFE_TIME lifetime —
// the same "amortize a body's output over its life" idiom mining/remoteEconomics.ts price upkeep with —
// so dividing the backlog by that lifetime capacity gives the steady-state WORK needed to clear it
// before it decays back in, not just "some" repairer regardless of how much is actually broken.
function backlogHits(colony: ColonySnapshot): number {
  return uncoveredDecay(colony).reduce((sum, s) => sum + ((s.hitsMax ?? 0) - (s.hits ?? 0)), 0);
}

function repairerBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("repair")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

function wantedRepairers(colony: ColonySnapshot): number {
  const hits = backlogHits(colony);
  if (hits <= 0) return 0;
  const wantedWork = Math.ceil(hits / (REPAIR_POWER * CREEP_LIFE_TIME));
  const bodies = Math.ceil(wantedWork / repairerBodyWork(colony));
  return Math.min(config.maxRepairers, Math.max(1, bodies));
}

// Missing hits for one room's slice of the backlog — same figure backlogHits sums colony-wide, kept
// per-room so roomsWithDecay can rank rooms by how bad their damage is, not just how close they are.
function roomBacklogHits(colony: ColonySnapshot, room: string): number {
  const structures = room === colony.name ? colony.structures.filter(s => !coveredByTower(colony, s)) : colony.remoteStructures[room] ?? [];
  return structures.filter(isDecayed).reduce((sum, s) => sum + ((s.hitsMax ?? 0) - (s.hits ?? 0)), 0);
}

// Every room with tower-uncovered decay this tick, worst backlog first (distance breaks a tie) —
// remoteStructures is vision-gated (present only for a remote room a creep is currently standing in),
// same rule buildTargetRoomIntents' siteSummary-vs-remoteSites split follows, just without a
// vision-independent fallback: decay in a remote room with no vision simply isn't known about until a
// creep is standing there again.
function roomsWithDecay(colony: ColonySnapshot): string[] {
  const rooms: string[] = [];
  if (homeUncovered(colony)) rooms.push(colony.name);
  for (const [room, structures] of Object.entries(colony.remoteStructures)) {
    if (structures?.some(isDecayed)) rooms.push(room);
  }
  return rooms.sort((a, b) => {
    const hitsDiff = roomBacklogHits(colony, b) - roomBacklogHits(colony, a);
    if (hitsDiff !== 0) return hitsDiff;
    return roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b);
  });
}

// Reassign only a repairer whose current room's decay has cleared — keeps every other repairer's
// assignment stable tick to tick, same rule as building.ts's buildTargetRoomIntents.
function repairTargetRoomIntents(colony: ColonySnapshot): Intent[] {
  const candidates = roomsWithDecay(colony);
  if (candidates.length === 0) return [];
  const out: Intent[] = [];
  for (const creep of colony.creeps) {
    if (creep.role !== "repair") continue;
    if (creep.memory.repairTargetRoom && candidates.includes(creep.memory.repairTargetRoom)) continue;
    out.push({ kind: "setRepairTargetRoom", creep: creep.id, room: candidates[0] });
  }
  return out;
}

export class Repairing extends Operation {
  public readonly kind = "repairing";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "repair", wantedRepairers(colony), roleDef("repair")!.priority);
  }

  /** Report the true repairer target (0 once towers cover everything), so census shows any surplus as `N/0`. */
  public override roleTargets(colony: ColonySnapshot): RoleTarget[] {
    return [{ role: "repair", target: wantedRepairers(colony) }];
  }

  /** Keeps every live repairer's cross-room assignment pointed at a room with tower-uncovered decay. */
  public override intents(colony: ColonySnapshot): Intent[] {
    return repairTargetRoomIntents(colony);
  }
}
