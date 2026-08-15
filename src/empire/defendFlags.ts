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
// Unlike a one-shot trigger, the flag's lifetime is now tied to its target's, in both directions (same
// shape as drainFlags.ts/paradeFlags.ts, applied per-target instead of to a scalar — see attackFlags.ts's
// header for the full reasoning, identical here): on a successful handoff the flag is left in place (not
// removed) and its name recorded onto the target via addDefendTarget's `flag` field
// (ColonyMemory.defendingFlags); the moment that flag disappears from Game.flags, the next tick's second
// pass here drops just that one target (removeDefendTarget) — the rest of a colony's other
// flag-sponsored targets, plus its own home/remote hostiles, are untouched, since Defense pools every
// target behind one shared defender fleet (see defense.ts's header) rather than one operation per target.
// The reverse also holds: when Defense's own completion logic removes a target on its own (room seen
// clear — see defense.ts's intents()), execute.ts prunes defendingFlags for it, and this module's third
// pass notices the now-orphaned flag name and removes the actual flag.
//
// One flag = one handoff, same dedup shape as before: placing the same flag again while its target is
// already being defended is a harmless no-op.

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
 * hands the target off to the nearest affordable colony (flag left in place as the target's live switch),
 * drops any flag-sponsored target whose flag has since disappeared, and removes any flag whose target has
 * since been dropped by Defense's own completion logic — see file header for the full shape. */
export function runDefendFlags(world: Empire): void {
  const flags = defendFlags();
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
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

    execute([{ kind: "addDefendTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`defend flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target now (see file header).
  }

  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagsByTarget = mem?.defendingFlags ?? {};
    for (const [target, flagName] of Object.entries(flagsByTarget)) {
      // Reads live Memory.defending, not colony.snapshot.defending — see attackFlags.ts's identical
      // comment for why the stale snapshot would misfire on a target this same call just added.
      const stillListed = (mem?.defending ?? []).includes(target);
      if (stillListed && !liveByName.has(flagName)) {
        // The flag is gone but the target is still active: stop defending it.
        execute([{ kind: "removeDefendTarget", room: colony.name, target }]);
        log.info(`defend flag "${flagName}" is gone: stopping ${colony.name}'s defense of ${target}`);
      } else if (!stillListed) {
        // The target is gone (Defense's own completion logic dropped it) but its flag is still standing:
        // remove the now-orphaned flag so it doesn't linger as a dead marker.
        liveByName.get(flagName)?.remove();
        log.info(`defend target ${target} is gone: removing its flag "${flagName}"`);
      }
    }
  }
}
