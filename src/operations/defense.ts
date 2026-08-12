// Defense owns towers and safemode: attack hostiles, heal friendlies otherwise, safemode when towerless and invaded.
// Goes through intents() not desiredCreeps(): tower fire is direct action that must run every tick, untiered.
// Always attached (operationsFor(), unlike Attack/Colonize/Drain/Parade — see operations/index.ts), so a
// flag-requested rescue of another room doesn't get its own operation class: a "defend"/"defend:<room>"
// flag (defendFlags.ts) just adds a room to ColonyMemory.defending, which this pools alongside home/remote
// hostiles into the same shared defender fleet (see roomsWithHostiles/openSponsoredTargets below).

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { effectiveIncomingDamage, incomingHeal, towerDamageAt } from "../lib/combat";
import { closest, range } from "../lib/geometry";
import { log } from "../lib/log";
import { needsRepair } from "../lib/repairable";
import { isExitTile } from "../lib/remotePath";
import { roomLinearDistance } from "../lib/roomName";
import type { ColonySnapshot, SnapStructure, SnapUnit } from "../snapshot/types";
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
// most worth holding), then remotes nearest first, then any flag-sponsored `defending` target still open
// (see openSponsoredTargets below — a rescue of another colony's room, or any arbitrary room, requested
// via a "defend"/"defend:<room>" flag and handed off through defendFlags.ts/addDefendTarget). remoteSources'
// danger is vision-independent (cached via RemoteMemory.dangerUntil, see remote-danger-until), so a
// defender still gets dispatched at an invaded remote the colony has since lost direct vision of.
function roomsWithHostiles(colony: ColonySnapshot): string[] {
  const rooms: string[] = [];
  if (colony.hostiles.length > 0) rooms.push(colony.name);
  const remoteRooms = new Set(colony.remoteSources.filter(s => s.danger > 0).map(s => s.room));
  rooms.push(...[...remoteRooms].sort((a, b) => roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b)));
  rooms.push(...openSponsoredTargets(colony).sort((a, b) => roomLinearDistance(colony.name, a) - roomLinearDistance(colony.name, b)));
  return rooms;
}

// Flag-sponsored defend targets (ColonyMemory.defending) not yet seen clear — the defensive equivalent of
// Attack's openTargets. Vision-gated the same way roomCleared() is below: a target the colony has never
// scouted must not read as already-clear just because no visibleRooms entry says otherwise.
function openSponsoredTargets(colony: ColonySnapshot): string[] {
  return colony.defending.filter(t => !roomCleared(colony, t));
}

// True once `room` has been seen this tick (someone in the empire has vision of it) with no hostiles left
// — same rule Attack's roomCleared uses (see operations/attack.ts's header for why absence from
// visibleRooms must never read as cleared).
function roomCleared(colony: ColonySnapshot, room: string): boolean {
  return colony.visibleRooms.find(r => r.room === room)?.hostileCount === 0;
}

// Total hostile count across every invaded room — home (live count) plus one nominal hostile per invaded
// remote or open sponsored target (their danger/presence is a 0/1 flag, not a headcount; a full count
// isn't known without vision, so a defender is still requested for every one that needs one).
function totalThreat(colony: ColonySnapshot, invadedRooms: string[]): number {
  const otherCount = invadedRooms.filter(r => r !== colony.name).length;
  return colony.hostiles.length + otherCount;
}

// Keeps every live defender's room assignment pointed at a room that still has hostiles — reassigns only
// a defender whose current room has cleared, same rule as Repairing's repairTargetRoomIntents.
function defendTargetRoomIntents(colony: ColonySnapshot, invadedRooms: string[]): Intent[] {
  if (invadedRooms.length === 0) return [];
  const out: Intent[] = [];
  for (const creep of colony.creeps) {
    if (creep.role !== "defender") continue;
    if (creep.memory.defendTargetRoom && invadedRooms.includes(creep.memory.defendTargetRoom)) continue;
    log.debugCreep(creep.name, `defense: assigning defendTargetRoom=${invadedRooms[0]} (was ${creep.memory.defendTargetRoom ?? "-"})`);
    out.push({ kind: "setDefendTargetRoom", creep: creep.id, room: invadedRooms[0] });
  }
  return out;
}

export class Defense extends Operation {
  public readonly kind = "defense";

  // Only while hostiles are actually present somewhere (home, a remote, or an open sponsored target) — a
  // defender idling with nothing to fight is pure upkeep cost, so the request (and the creep) disappears
  // the instant every invaded room clears.
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const invadedRooms = roomsWithHostiles(colony);
    if (invadedRooms.length === 0) return [];
    const wanted = Math.min(MAX_DEFENDERS, Math.ceil(totalThreat(colony, invadedRooms) / HOSTILES_PER_DEFENDER));
    log.debugRoom(
      colony.name,
      `defense: invaded=${invadedRooms.join(",")} threat=${totalThreat(colony, invadedRooms)} wanted=${wanted} owned=${this.owned(colony, "defender").length}`
    );
    return this.fillRole(colony, "defender", wanted, roleDef("defender")!.priority);
  }

  // Direct tower action plus keeping every defender's cross-room assignment current.
  public override intents(colony: ColonySnapshot): Intent[] {
    // Drop any flag-sponsored target that's been seen clear — the defensive equivalent of Attack's own
    // cleared-target cleanup (see operations/attack.ts's intents()). Home/remote hostile rooms need no
    // equivalent bookkeeping: they're derived fresh from live snapshot state every tick, not durable
    // memory, so there's nothing to remove.
    const cleared = colony.defending.filter(t => roomCleared(colony, t));
    for (const target of cleared) log.debugRoom(colony.name, `defense: ${target} seen clear — dropping as a sponsored target`);
    const out: Intent[] = [
      ...cleared.map(target => ({ kind: "removeDefendTarget" as const, room: colony.name, target })),
      ...defendTargetRoomIntents(colony, roomsWithHostiles(colony))
    ];
    if (colony.hostiles.length > 0) {
      // Towerless and invaded: safemode is the only defence left, so it short-circuits the rest.
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        log.debugRoom(colony.name, "defense: towerless and invaded — triggering safe mode");
        return [...out, { kind: "safeMode", room: colony.name }];
      }
      for (const tower of colony.towers) {
        const worthwhile = colony.hostiles.filter(h => worthShooting(colony, tower, h));
        const target = closest(tower, worthwhile);
        if (target) {
          out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
        } else if (colony.hostiles.length > 0) {
          log.debugRoom(colony.name, `defense: tower ${tower.id} holds fire — no hostile worth shooting (${colony.hostiles.length} present)`);
        }
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

// A hostile sitting on the room border can simply step out next tick, so shooting it is normally wasted
// unless the shot actually kills it — or it's already in melee range of something worth defending, where
// letting it live even one more tick risks real damage. Interior hostiles have no such escape and are
// always worth shooting — unless healing (its own, or a healer standing near it) can outpace the tower's
// damage entirely, in which case the shot never dents it and is pure energy waste regardless of position.
function worthShooting(colony: ColonySnapshot, tower: { x: number; y: number }, hostile: SnapUnit): boolean {
  const dmg = effectiveIncomingDamage(towerDamageAt(range(tower, hostile)), hostile.toughReduction);
  if (dmg <= incomingHeal(hostile, colony.hostiles)) return false;
  if (!isExitTile(hostile)) return true;
  if (dmg >= hostile.hits) return true;
  return colony.structures.some(s => s.id && range(s, hostile) <= 1);
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
