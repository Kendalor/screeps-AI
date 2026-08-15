// Flag-triggered SimpleBaitTower entry point — same "flag is the operation's lifetime" shape as
// drainFlags.ts, tied in BOTH directions: a flag named "simpleBaitTower" or "simpleBaitTower:<room>" both
// starts a SimpleBaitTower request (pick the nearest affordable colony, hand the target off via
// setSimpleBaitTowerTarget, recording the flag's own name onto ColonyMemory.simpleBaitTowerFlag) AND
// keeps it alive — the flag stays in place after handoff, and the moment it's gone, the next tick's pass
// here clears ColonyMemory.simpleBaitTower via clearSimpleBaitTowerTarget, detaching the operation.
//
// The reverse also holds, which is what sets SimpleBaitTower apart from Drain/Parade: this operation is a
// genuine one-shot (exactly one creep, ever — see operations/simpleBaitTower.ts's header), so it can end
// on its OWN once that one creep dies, with the flag still standing. When that happens the operation emits
// endSimpleBaitTower instead of clearSimpleBaitTowerTarget — deliberately leaving
// ColonyMemory.simpleBaitTowerFlag on record (see that intent's doc) so this module's second pass below
// can still find the now-orphaned flag and remove it, converging to the exact same terminal state either
// direction produces: no target, no flag.
//
// Two passes per tick: (1) every simpleBaitTower flag resolves/re-affirms its handoff; (2) every colony
// with a tracked simpleBaitTowerFlag gets checked — flag gone + target still active means the flag was
// removed (stop the operation); target gone + flag still standing means the operation ended itself
// (remove the orphaned flag).

import { pickSimpleBaitTowerSponsor } from "./simpleBaitTowerSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "simpleBaitTower";

/** Target room for a simpleBaitTower flag: an explicit "simpleBaitTower:<room>" suffix always wins; a
 * bare "simpleBaitTower" flag falls back to its own physical room when that room has vision. */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a simpleBaitTower request ("simpleBaitTower" or
 * "simpleBaitTower:<room>"). */
function simpleBaitTowerFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// drainFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active simpleBaitTower flag against the current
 * empire, hands the target off to the nearest affordable colony with no SimpleBaitTower of its own
 * already in progress, and reconciles every colony's tracked flag against both directions of the
 * lifetime link — see file header for the full shape. */
export function runSimpleBaitTowerFlags(world: Empire): void {
  const flags = simpleBaitTowerFlags();
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`simpleBaitTower flag "${flag.name}": can't tell the target room — place it in-room or name it "simpleBaitTower:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already running it.
    const alreadySent = world.colonies.some(c => c.snapshot.simpleBaitTower === target);
    if (alreadySent) continue;

    // A colony already running a *different* target isn't an eligible sponsor for a new one — one active
    // SimpleBaitTower per colony at a time, same rule Drain/Parade use.
    const eligible = world.colonies.filter(c => c.snapshot.simpleBaitTower === undefined);

    const pick = pickSimpleBaitTowerSponsor(eligible, target, routeDistance);
    if (!pick.colony) {
      log.error(`simpleBaitTower flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "setSimpleBaitTowerTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`simpleBaitTower flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target (see file header).
  }

  // Reconcile every colony that still has a flag on record — reads live Memory, not the (now-stale)
  // snapshot, same reasoning as colonizeFlags.ts's equivalent pass: this must see whatever
  // setSimpleBaitTowerTarget/endSimpleBaitTower the earlier loop or the operation's own intents() already
  // issued this same tick.
  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagName = mem?.simpleBaitTowerFlag;
    if (!flagName) continue;

    const flagStillLive = liveByName.has(flagName);
    const targetStillActive = mem?.simpleBaitTower !== undefined;

    if (targetStillActive && !flagStillLive) {
      // The flag was removed but the operation is still running: stop it.
      execute([{ kind: "clearSimpleBaitTowerTarget", room: colony.name }]);
      log.info(`simpleBaitTower flag "${flagName}" is gone: stopping ${colony.name}'s SimpleBaitTower`);
    } else if (!targetStillActive && flagStillLive) {
      // The operation ended itself (its one creep died — see operations/simpleBaitTower.ts's header) but
      // the flag is still standing: remove the now-orphaned flag, then drop the now-stale record of it.
      liveByName.get(flagName)?.remove();
      execute([{ kind: "clearSimpleBaitTowerTarget", room: colony.name }]);
      log.info(`simpleBaitTower for "${colony.name}" ended: removing its now-orphaned flag "${flagName}"`);
    }
  }
}
