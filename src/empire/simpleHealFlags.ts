// Flag-triggered SimpleHeal entry point — same "flag is the operation's lifetime" shape as
// simpleBaitTowerFlags.ts/demolishFlags.ts, tied in BOTH directions: a flag named "simpleHeal" or
// "simpleHeal:<room>" both starts a SimpleHeal request (pick the nearest affordable colony, hand the
// target off via setSimpleHealTarget, recording the flag's own name onto ColonyMemory.simpleHealFlag)
// AND keeps it alive — the flag stays in place after handoff, and the moment it's gone, the next tick's
// pass here clears ColonyMemory.simpleHeal via clearSimpleHealTarget, detaching the operation.
//
// TODO — decide whether SimpleHeal can also end itself (SimpleBaitTower's one-shot "creep died" shape,
// emitting endSimpleHeal) or only ever stops via flag removal (Drain/Parade's shape). See
// operations/simpleHeal.ts's header for the same open question.

import { pickSimpleHealSponsor } from "./simpleHealSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "simpleHeal";

/** Target room for a simpleHeal flag: an explicit "simpleHeal:<room>" suffix always wins; a bare
 * "simpleHeal" flag falls back to its own physical room when that room has vision. */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a simpleHeal request ("simpleHeal" or "simpleHeal:<room>"). */
function simpleHealFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// drainFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active simpleHeal flag against the current
 * empire, hands the target off to the nearest affordable colony with no SimpleHeal of its own already in
 * progress, and reconciles every colony's tracked flag against the flag-removal lifetime link. */
export function runSimpleHealFlags(world: Empire): void {
  const flags = simpleHealFlags();
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`simpleHeal flag "${flag.name}": can't tell the target room — place it in-room or name it "simpleHeal:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already running it.
    const alreadySent = world.colonies.some(c => c.snapshot.simpleHeal === target);
    if (alreadySent) continue;

    // A colony already running a *different* target isn't an eligible sponsor for a new one — one active
    // SimpleHeal per colony at a time, same rule Drain/Parade/SimpleBaitTower/Demolish use.
    const eligible = world.colonies.filter(c => c.snapshot.simpleHeal === undefined);

    const pick = pickSimpleHealSponsor(eligible, target, routeDistance);
    if (!pick.colony) {
      log.error(`simpleHeal flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "setSimpleHealTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`simpleHeal flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target (see file header).
  }

  // Reconcile every colony that still has a flag on record — reads live Memory, not the (now-stale)
  // snapshot, same reasoning as colonizeFlags.ts's equivalent pass.
  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagName = mem?.simpleHealFlag;
    if (!flagName) continue;

    const flagStillLive = liveByName.has(flagName);
    const targetStillActive = mem?.simpleHeal !== undefined;

    if (targetStillActive && !flagStillLive) {
      // The flag was removed but the operation is still running: stop it.
      execute([{ kind: "clearSimpleHealTarget", room: colony.name }]);
      log.info(`simpleHeal flag "${flagName}" is gone: stopping ${colony.name}'s SimpleHeal`);
    }
    // TODO — mirror SimpleBaitTower's "operation ended itself, remove the now-orphaned flag" branch here
    // once simpleHeal.ts's one-shot-vs-maintained question (see its header) is settled.
  }
}
