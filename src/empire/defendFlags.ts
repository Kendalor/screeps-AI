// Flag-triggered defend entry point — sponsors a defender at a room outside the sponsoring colony's own
// home/remotes (an allied or sister colony under attack, say). Not wired into SYSTEMS/operationsFor itself
// (Defense already is; this just feeds it extra targets), so this runs as its own call from
// kernel/tick.ts, independent of the per-colony pipeline.
//
// One-shot: the flag is removed the instant handoff succeeds (placing it again re-triggers on purpose,
// e.g. after a failed attempt is cleaned up) — unlike drain/parade, where the flag IS the operation's
// lifetime. On failure the flag stays and logs an error every tick, so silence never hides a stuck request.

import { pickDefendSponsor } from "./defendSponsor";
import { flagRequests, routeDistance, targetRoomFor } from "./flagRequest";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "defend";

/** Runs once per tick from kernel/tick.ts. Resolves every active defend flag against the current empire,
 * hands the target off to the nearest affordable colony, and clears the flag on success. */
export function runDefendFlags(world: Empire): void {
  for (const flag of flagRequests(FLAG_PREFIX)) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`defend flag "${flag.name}": can't tell the target room — place it in-room or name it "defend:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already defending it.
    const alreadySent = world.colonies.some(c => c.snapshot.defending.includes(target));
    if (alreadySent) continue;

    const pick = pickDefendSponsor(world.colonies, target, routeDistance);
    if (!pick.colony) {
      log.error(`defend flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "addDefendTarget", room: pick.colony.name, target }]);
    log.info(`defend flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    flag.remove();
  }
}
