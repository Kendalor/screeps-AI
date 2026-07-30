// Repairing owns the dedicated repair workforce: decay no tower reaches — either because the colony
// has no tower yet, or the decayed structure sits beyond a tower's efficient repair range (remote
// infrastructure, or a bunker structure just outside range). Tower-covered decay is Defense's job.
// Decay in a selected remote room is always uncovered — towers only ever live in the home room.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { needsRepair } from "../lib/repairable";
import { roomLinearDistance } from "../lib/roomName";
import { coveredByTower } from "./defense";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation, type RoleTarget } from "./operation";

function isDecayed(s: SnapStructure): boolean {
  return s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax);
}

function homeUncovered(colony: ColonySnapshot): boolean {
  return colony.structures.some(s => isDecayed(s) && !coveredByTower(colony, s));
}

function wantedRepairers(colony: ColonySnapshot): number {
  const uncovered = homeUncovered(colony) || Object.values(colony.remoteStructures).some(list => list?.some(isDecayed));
  return uncovered ? 1 : 0;
}

// Every room with tower-uncovered decay this tick, nearest first — remoteStructures is vision-gated
// (present only for a remote room a creep is currently standing in), same rule buildTargetRoomIntents'
// siteSummary-vs-remoteSites split follows, just without a vision-independent fallback: decay in a
// remote room with no vision simply isn't known about until a creep is standing there again.
function roomsWithDecay(colony: ColonySnapshot): string[] {
  const rooms: string[] = [];
  if (homeUncovered(colony)) rooms.push(colony.name);
  for (const [room, structures] of Object.entries(colony.remoteStructures)) {
    if (structures?.some(isDecayed)) rooms.push(room);
  }
  return rooms.sort((a, b) => roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b));
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
