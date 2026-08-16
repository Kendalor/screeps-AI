// Flag-triggered colonize entry point — the manual equivalent of the empire-scoped auto-picker
// (pickColonyTargets.ts); both enter through pickColonizeSponsor. Not wired into operationsFor/SYSTEMS
// (Colonize isn't a default operation), so this runs as its own call from main.ts's loop(), independent
// of the per-colony pipeline.
//
// Unlike a one-shot trigger, the flag's lifetime is now tied to its target's, in both directions (same
// shape as drainFlags.ts/paradeFlags.ts, applied per-target instead of to a scalar — see attackFlags.ts's
// header for the full reasoning, identical here): on a successful handoff the flag is left in place (not
// removed) and its name recorded onto the target via addColonizeTarget's `flag` field
// (ColonyMemory.colonizingFlags); the moment that flag disappears from Game.flags, the next tick's second
// pass here drops just that one target (removeColonizeTarget). The reverse also holds: when Colonize's own
// completion logic removes a target on its own (succeeded or permanently failed — see colonize.ts's
// intents()), execute.ts prunes colonizingFlags for it, and this module's third pass notices the
// now-orphaned flag name and removes the actual flag. A target sponsored by the auto-picker
// (pickColonyTargets.ts, no flag involved) is simply never tracked here at all — unlike Attack/Defend,
// Colonize genuinely is one operation instance per target (see colony/index.ts's constructor), but the
// flag-tracking shape stays identical since it's the target, not the operation, that's tied to a flag.
//
// One flag = one handoff, same dedup shape as before: placing the same flag again while its target is
// already being colonized is a harmless no-op.

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

/** Runs once per tick from main.ts. Resolves every active colonize flag against the current empire, hands
 * the target off to the best sponsor colony it finds (flag left in place as the target's live switch),
 * drops any flag-sponsored target whose flag has since disappeared, and removes any flag whose target has
 * since been dropped by Colonize's own completion logic — see file header for the full shape. */
export function runColonizeFlags(world: Empire): void {
  const flags = flagRequests(FLAG_PREFIX);
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
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

    execute([{ kind: "addColonizeTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`colonize flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target now (see file header).
  }

  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagsByTarget = mem?.colonizingFlags ?? {};
    for (const [target, flagName] of Object.entries(flagsByTarget)) {
      // Reads live Memory.colonizing, not colony.snapshot.colonizing — see attackFlags.ts's identical
      // comment for why the stale snapshot would misfire on a target this same call just added.
      const stillListed = (mem?.colonizing ?? []).includes(target);
      if (stillListed && !liveByName.has(flagName)) {
        // The flag is gone but the target is still active: stop colonizing it.
        execute([{ kind: "removeColonizeTarget", room: colony.name, target }]);
        log.info(`colonize flag "${flagName}" is gone: stopping ${colony.name}'s colonize of ${target}`);
      } else if (!stillListed) {
        // The target is gone (Colonize's own completion logic dropped it) but its flag is still standing:
        // remove the now-orphaned flag so it doesn't linger as a dead marker.
        liveByName.get(flagName)?.remove();
        log.info(`colonize target ${target} is gone: removing its flag "${flagName}"`);
      }
    }
  }
}
