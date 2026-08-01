// Flag-triggered colonize entry point. A flag named "colonize" or "colonize:<room>" is the manual
// equivalent of the empire-scoped auto-picker (pickColonyTargets.ts) — both enter through
// pickColonizeSponsor and both hand off via the same addColonizeTarget intent; this module is just
// today's manual trigger for it. Not wired into operationsFor/SYSTEMS (Colonize itself isn't a default
// operation), so this runs as its own call from main.ts's loop(), independent of the per-colony
// operation pipeline.
//
// One flag = one handoff: on success the target is durably recorded (ColonyMemory.colonizing, via
// addColonizeTarget — see colonize.ts's header) and the flag is removed immediately (placing it again
// re-triggers, e.g. if the whole attempt later fails and gets cleaned up — see the project's
// flag-lifecycle decision). From that tick on, Colony's constructor attaches a real Colonize operation
// for the target and its colonizer/settler spawn through the completely normal per-tick arbiter — this
// module's job ends at the handoff, it never spawns anything directly. On failure (no fitting colony)
// the flag is left in place and an error is logged every tick it's still unresolved, so the player sees
// why nothing is happening rather than silence.

import { pickColonizeSponsor } from "./colonizeSponsor";
import { execute } from "../intents/execute";
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
 * hands the target off to the best sponsor colony it finds, and clears the flag on success. */
export function runColonizeFlags(world: Empire): void {
  for (const flag of colonizeFlags()) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`colonize flag "${flag.name}": can't tell the target room — place it in-room or name it "colonize:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already
    // colonizing it. Durable check (ColonyMemory.colonizing), not a live-creep one — the target is
    // "claimed" the instant the handoff lands, before any colonizer has even spawned yet.
    const alreadySent = world.colonies.some(c => c.snapshot.colonizing.includes(target));
    if (alreadySent) continue;

    const pick = pickColonizeSponsor(world.colonies, target, routeDistance, Game.gcl.level);
    if (!pick.colony) {
      log.error(`colonize flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "addColonizeTarget", room: pick.colony.name, target }]);
    log.info(`colonize flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    flag.remove();
  }
}
