// Flag-triggered attack entry point. Not wired into SYSTEMS/operationsFor (Attack isn't a default
// operation), so this runs as its own call from kernel/tick.ts, independent of the per-colony pipeline.
//
// One-shot: the flag is removed the instant handoff succeeds (placing it again re-triggers on purpose,
// e.g. after a failed attempt is cleaned up) — unlike drain/parade, where the flag IS the operation's
// lifetime. On failure the flag stays and logs an error every tick, so silence never hides a stuck request.

import { pickAttackSponsor } from "./attackSponsor";
import { flagRequests, routeDistance } from "./flagRequest";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "attack";

/** Target room for an attack flag: an explicit "attack:<room>" suffix always wins; a bare "attack" flag
 * falls back to its own physical room only when that room has vision (a controller isn't required — an
 * unowned/hostile room still resolves this way). */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active attack flag against the current empire,
 * hands the target off to the nearest affordable colony, and clears the flag on success. */
export function runAttackFlags(world: Empire): void {
  for (const flag of flagRequests(FLAG_PREFIX)) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`attack flag "${flag.name}": can't tell the target room — place it in-room or name it "attack:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already attacking it.
    const alreadySent = world.colonies.some(c => c.snapshot.attacking.includes(target));
    if (alreadySent) continue;

    const pick = pickAttackSponsor(world.colonies, target, routeDistance);
    if (!pick.colony) {
      log.error(`attack flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "addAttackTarget", room: pick.colony.name, target }]);
    log.info(`attack flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    flag.remove();
  }
}
