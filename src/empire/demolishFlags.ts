// Flag-triggered Demolish entry point — same "flag is the operation's lifetime" shape as
// simpleBaitTowerFlags.ts, tied in BOTH directions: a flag named "demolish" or "demolish:<room>" both
// starts a Demolish request (pick the nearest affordable colony, hand the target off via
// setDemolishTarget, recording the flag's own name onto ColonyMemory.demolishFlag) AND keeps it alive —
// the flag stays in place after handoff, and the moment it's gone, the next tick's pass here clears
// ColonyMemory.demolish via clearDemolishTarget, detaching the operation.
//
// TODO — decide whether Demolish can also end itself (SimpleBaitTower's one-shot "creep died" shape,
// emitting endDemolish) or only ever stops via flag removal (Drain/Parade's shape). See
// operations/demolish.ts's header for the same open question.

import { pickDemolishSponsor } from "./demolishSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "demolish";

/** Target room for a demolish flag: an explicit "demolish:<room>" suffix always wins; a bare "demolish"
 * flag falls back to its own physical room when that room has vision. */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a demolish request ("demolish" or "demolish:<room>"). */
function demolishFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// drainFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active demolish flag against the current
 * empire, hands the target off to the nearest affordable colony with no Demolish of its own already in
 * progress, and reconciles every colony's tracked flag against the flag-removal lifetime link. */
export function runDemolishFlags(world: Empire): void {
  const flags = demolishFlags();
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`demolish flag "${flag.name}": can't tell the target room — place it in-room or name it "demolish:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already running it.
    const alreadySent = world.colonies.some(c => c.snapshot.demolish === target);
    if (alreadySent) continue;

    // A colony already running a *different* target isn't an eligible sponsor for a new one — one active
    // Demolish per colony at a time, same rule Drain/Parade/SimpleBaitTower use.
    const eligible = world.colonies.filter(c => c.snapshot.demolish === undefined);

    const pick = pickDemolishSponsor(eligible, target, routeDistance);
    if (!pick.colony) {
      log.error(`demolish flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "setDemolishTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`demolish flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target (see file header).
  }

  // Reconcile every colony that still has a flag on record — reads live Memory, not the (now-stale)
  // snapshot, same reasoning as colonizeFlags.ts's equivalent pass.
  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagName = mem?.demolishFlag;
    if (!flagName) continue;

    const flagStillLive = liveByName.has(flagName);
    const targetStillActive = mem?.demolish !== undefined;

    if (targetStillActive && !flagStillLive) {
      // The flag was removed but the operation is still running: stop it.
      execute([{ kind: "clearDemolishTarget", room: colony.name }]);
      log.info(`demolish flag "${flagName}" is gone: stopping ${colony.name}'s Demolish`);
    }
    // TODO — mirror SimpleBaitTower's "operation ended itself, remove the now-orphaned flag" branch here
    // once demolish.ts's one-shot-vs-maintained question (see its header) is settled.
  }
}
