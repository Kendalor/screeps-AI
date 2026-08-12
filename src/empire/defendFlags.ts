// Flag-triggered defend entry point — the defensive twin of attackFlags.ts. A flag named "defend" or
// "defend:<room>" is the manual trigger for sponsoring a defender at a room outside the sponsoring
// colony's own home/remotes (an allied or sister colony under attack, say): pick the nearest affordable
// colony, hand the target off via addDefendTarget, and let the normal per-tick operation pipeline take it
// from there (Defense already runs unconditionally on every colony, see operations/defense.ts — this only
// adds `target` to the set of rooms it pools a defender onto). Not wired into SYSTEMS/operationsFor
// itself (Defense already is; this just feeds it extra targets), so this runs as its own call from
// kernel/tick.ts's tick(), independent of the per-colony operation pipeline — same reasoning as
// attackFlags.ts/colonizeFlags.ts.
//
// One flag = one handoff: on success the target is durably recorded (ColonyMemory.defending, via
// addDefendTarget) and the flag is removed immediately (placing it again re-triggers, e.g. if the whole
// attempt later fails and gets cleaned up). From that tick on, Defense.desiredCreeps/intents pool a
// defender onto the target through the completely normal per-tick arbiter — this module's job ends at the
// handoff. On failure (no fitting colony) the flag is left in place and an error is logged every tick
// it's still unresolved, so the player sees why nothing is happening.

import { pickDefendSponsor } from "./defendSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "defend";

/** Target room for a defend flag — same rule as attackFlags' targetRoomFor: an explicit "defend:<room>"
 * suffix always wins; a bare "defend" flag falls back to its own physical room only when that room has
 * vision (a controller isn't required). */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a defend request ("defend" or "defend:<room>"). */
function defendFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// attackFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate (see defendSponsor.ts).
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active defend flag against the current empire,
 * hands the target off to the nearest affordable colony, and clears the flag on success. */
export function runDefendFlags(world: Empire): void {
  for (const flag of defendFlags()) {
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
