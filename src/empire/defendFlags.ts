// Flag-triggered defend entry point — sponsors a defender at a room outside the sponsoring colony's own
// home/remotes (an allied or sister colony under attack, say). Not wired into SYSTEMS/operationsFor itself
// (Defense already is; this just feeds it extra targets), so this runs as its own call from
// kernel/tick.ts, independent of the per-colony pipeline.
//
// Unlike a one-shot trigger, the flag's lifetime is now tied to its target's, in both directions (same
// shape as drainFlags.ts/paradeFlags.ts, applied per-target instead of to a scalar — see attackFlags.ts's
// header for the full reasoning, identical here): on a successful handoff the flag is left in place (not
// removed) and its name recorded onto the target via addDefendTarget's `flag` field
// (ColonyMemory.defendingFlags); the moment that flag disappears from Game.flags, the next tick's second
// pass here drops just that one target (removeDefendTarget) — the rest of a colony's other
// flag-sponsored targets, plus its own home/remote hostiles, are untouched, since Defense pools every
// target behind one shared defender fleet (see defense.ts's header) rather than one operation per target.
// The reverse also holds: when Defense's own completion logic removes a target on its own (the room has
// gone into another player's safe mode and turned into a dead zone — a merely-clear room is deliberately
// NOT auto-dropped, a defend flag is a standing garrison order, see defense.ts's openSponsoredTargets doc),
// execute.ts prunes defendingFlags for it, and this module's third pass notices the now-orphaned flag name
// and removes the actual flag.
//
// One flag = one handoff, same dedup shape as before: placing the same flag again while its target is
// already being defended is a harmless no-op.

import { pickDefendSponsor } from "./defendSponsor";
import { flagRequests, routeDistance, targetRoomFor } from "./flagRequest";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "defend";

/** Runs once per tick from kernel/tick.ts. Resolves every active defend flag against the current empire,
 * hands the target off to the nearest affordable colony (flag left in place as the target's live switch),
 * drops any flag-sponsored target whose flag has since disappeared, and removes any flag whose target has
 * since been dropped by Defense's own completion logic — see file header for the full shape. */
export function runDefendFlags(world: Empire): void {
  const flags = flagRequests(FLAG_PREFIX);
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
