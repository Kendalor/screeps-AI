// Flag-triggered colonize entry point. A flag named "colonize" or "colonize:<room>" is the manual
// equivalent of the future empire-scoped auto-picker (see the colonize plan's phase 2) — both enter
// through pickColonizeSponsor; this module is just today's trigger for it. Not wired into
// operationsFor/SYSTEMS (Colonize itself isn't a default operation), so this runs as its own call from
// main.ts's loop(), independent of the per-colony operation pipeline.
//
// One flag = one colonizer request: on a successful spawn the flag is removed immediately (placing it
// again re-triggers, e.g. if the first colonizer dies en route — see the project's flag-lifecycle
// decision). On failure (no fitting colony) the flag is left in place and an error is logged every tick
// it's still unresolved, so the player sees why nothing is happening rather than silence.

import { pickColonizeSponsor } from "./colonizeSponsor";
import { spawnColonizer } from "./spawnColonizer";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "colonize";

/** Target room for a colonize flag: an explicit "colonize:<room>" name suffix always wins — a named
 * target must never be silently overridden by wherever the flag happens to physically sit (e.g. placed
 * from the map view centred on the player's own base, which has vision+a controller and would otherwise
 * hijack a bare-name flag meant for a different room entirely). Falls back to the flag's own physical
 * room only for a plain "colonize" flag with no suffix, and only when that room has vision+a controller
 * (the "place it standing in the target room" convenience). Undefined if neither yields a usable name. */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]?.controller) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a colonize request ("colonize" or "colonize:<room>"). */
function colonizeFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms at all — see
// colonizeSponsor.ts's header for why this must be findRoute-based, not getRoomLinearDistance.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from main.ts. Resolves every active colonize flag against the current empire,
 * spawns a colonizer from the best sponsor colony it finds, and clears the flag on success. */
export function runColonizeFlags(world: Empire): void {
  for (const flag of colonizeFlags()) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`colonize flag "${flag.name}": can't tell the target room — place it in-room or name it "colonize:<room>"`);
      continue;
    }

    // Already sent for this exact target: don't pick a second sponsor while one's still en route. Mirrors
    // Colonize.desiredCreeps()'s own one-per-target dedup, just checked across every colony up front.
    const alreadySent = world.colonies.some(c =>
      c.snapshot.creeps.some(cr => cr.role === "colonizer" && cr.memory.targetRoom === target)
    );
    if (alreadySent) continue;

    const pick = pickColonizeSponsor(world.colonies, target, routeDistance, Game.gcl.level);
    if (!pick.colony) {
      log.error(`colonize flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    const outcome = spawnColonizer(pick.colony, target);
    if (outcome !== "spawned") {
      log.error(`colonize flag "${flag.name}": ${pick.colony.name} ${outcome}, retrying next tick`);
      continue;
    }

    log.info(`colonize flag "${flag.name}": spawning colonizer for ${target} from ${pick.colony.name}`);
    flag.remove();
  }
}
