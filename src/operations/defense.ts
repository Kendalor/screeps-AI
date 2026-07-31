// Defense owns towers and safemode: attack hostiles, heal friendlies otherwise, safemode when towerless and invaded.
// Goes through intents() not desiredCreeps(): tower fire is direct action that must run every tick, untiered.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { closest, range } from "../lib/geometry";
import { needsRepair } from "../lib/repairable";
import { roomLinearDistance } from "../lib/roomName";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Beyond this range a tower's repair falloff (TOWER_OPTIMAL_RANGE = 5) has already started eating into
// its output, so structure upkeep past it is left for a repairer creep instead — a creep's WORK part
// repairs at a flat rate regardless of distance, unlike a tower's. Exported so Repairing can tell
// whether a given decayed structure is tower-covered before requesting a dedicated repairer for it.
export const TOWER_REPAIR_RANGE = 6;

// How many live hostiles one defender is assumed to handle. Towers already do the real damage race in
// the home room (see intents() below); a defender exists to mop up what wanders out of tower range, hold
// the line in a towerless room, or fight in a remote where no tower ever reaches — so it scales gently
// rather than matching invaders 1:1.
const HOSTILES_PER_DEFENDER = 2;
const MAX_DEFENDERS = 3; // hard ceiling — a bigger incursion than this needs the player's attention, not an ever-growing spawn queue

// Every room currently holding a hostile — home first (already vision-covered every tick, and the room
// most worth holding), then remotes nearest first. remoteSources' danger is vision-independent (cached
// via RemoteMemory.dangerUntil, see remote-danger-until), so a defender still gets dispatched at an
// invaded remote the colony has since lost direct vision of.
function roomsWithHostiles(colony: ColonySnapshot): string[] {
  const rooms: string[] = [];
  if (colony.hostiles.length > 0) rooms.push(colony.name);
  const remoteRooms = new Set(colony.remoteSources.filter(s => s.danger > 0).map(s => s.room));
  rooms.push(...[...remoteRooms].sort((a, b) => roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b)));
  return rooms;
}

// Total hostile count across every invaded room — home (live count) plus one nominal hostile per
// invaded remote (remoteSources' danger is a 0/1 presence flag, not a headcount; a full count isn't
// known without vision, so a defender is still requested for every remote that needs one).
function totalThreat(colony: ColonySnapshot, invadedRooms: string[]): number {
  const remoteCount = invadedRooms.filter(r => r !== colony.name).length;
  return colony.hostiles.length + remoteCount;
}

// Keeps every live defender's room assignment pointed at a room that still has hostiles — reassigns only
// a defender whose current room has cleared, same rule as Repairing's repairTargetRoomIntents.
function defendTargetRoomIntents(colony: ColonySnapshot, invadedRooms: string[]): Intent[] {
  if (invadedRooms.length === 0) return [];
  const out: Intent[] = [];
  for (const creep of colony.creeps) {
    if (creep.role !== "defender") continue;
    if (creep.memory.defendTargetRoom && invadedRooms.includes(creep.memory.defendTargetRoom)) continue;
    out.push({ kind: "setDefendTargetRoom", creep: creep.id, room: invadedRooms[0] });
  }
  return out;
}

export class Defense extends Operation {
  public readonly kind = "defense";

  // Only while hostiles are actually present somewhere (home or a remote) — a defender idling with
  // nothing to fight is pure upkeep cost, so the request (and the creep) disappears the instant every
  // invaded room clears.
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const invadedRooms = roomsWithHostiles(colony);
    if (invadedRooms.length === 0) return [];
    const wanted = Math.min(MAX_DEFENDERS, Math.ceil(totalThreat(colony, invadedRooms) / HOSTILES_PER_DEFENDER));
    return this.fillRole(colony, "defender", wanted, roleDef("defender")!.priority);
  }

  // Direct tower action plus keeping every defender's cross-room assignment current.
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = defendTargetRoomIntents(colony, roomsWithHostiles(colony));
    if (colony.hostiles.length > 0) {
      // Towerless and invaded: safemode is the only defence left, so it short-circuits the rest.
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        return [{ kind: "safeMode", room: colony.name }];
      }
      for (const tower of colony.towers) {
        const target = closest(tower, colony.hostiles);
        if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
      }
      return out;
    }
    // No hostiles: heal a wounded friendly first — rarer and time-critical — else repair the closest
    // decayed structure still within efficient tower range.
    for (const tower of colony.towers) {
      const hurt = closest(tower, colony.woundedFriendlies);
      if (hurt) {
        out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
        continue;
      }
      const decayed = closestRepairable(tower, colony.structures);
      if (decayed?.id) out.push({ kind: "towerRepair", tower: tower.id, target: decayed.id });
    }
    return out;
  }
}

function closestRepairable(from: { x: number; y: number }, structures: readonly SnapStructure[]): SnapStructure | undefined {
  return closest(from, structures.filter(s => isTowerRepairable(s) && range(from, s) <= TOWER_REPAIR_RANGE));
}

function isTowerRepairable(s: SnapStructure): boolean {
  return s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax);
}

// Whether a tower already covers this decayed structure — Repairing skips requesting a creep for it if so.
export function coveredByTower(colony: ColonySnapshot, structure: SnapStructure): boolean {
  return colony.towers.some(t => range(t, structure) <= TOWER_REPAIR_RANGE);
}
