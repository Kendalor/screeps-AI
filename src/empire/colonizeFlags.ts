// Flag-triggered colonize entry point — the manual equivalent of the empire-scoped auto-picker
// (pickColonyTargets.ts); both enter through pickColonizeSponsor. Not wired into operationsFor/SYSTEMS
// (Colonize isn't a default operation), so this runs as its own call from main.ts's loop(), independent
// of the per-colony pipeline.
//
// One-shot: the flag is removed the instant handoff succeeds (placing it again re-triggers on purpose,
// e.g. after a failed attempt is cleaned up) — unlike drain/parade, where the flag IS the operation's
// lifetime. On failure the flag stays and logs an error every tick, so silence never hides a stuck request.

import { pickColonizeSponsor } from "./colonizeSponsor";
import { flagRequests, routeDistance } from "./flagRequest";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "colonize";

/** Target room for a colonize flag: an explicit "colonize:<room>" suffix always wins — a named target
 * must never be silently overridden by wherever the flag happens to physically sit (e.g. placed from the
 * map view centred on the player's own base, which has vision+a controller and would otherwise hijack a
 * bare-name flag meant for a different room). Falls back to the flag's own physical room only when that
 * room has vision+a controller (unlike attack/defend/drain, which don't require a controller — those
 * targets can be unowned/hostile rooms). */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]?.controller) return flag.pos.roomName;
  return undefined;
}

/** Runs once per tick from main.ts. Resolves every active colonize flag against the current empire,
 * hands the target off to the best sponsor colony it finds, and clears the flag on success. */
export function runColonizeFlags(world: Empire): void {
  for (const flag of flagRequests(FLAG_PREFIX)) {
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
