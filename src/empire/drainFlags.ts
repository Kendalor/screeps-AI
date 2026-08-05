// Flag-triggered drain entry point — the combat equivalent of attackFlags.ts, but unlike every other
// flag-triggered operation (attack/colonize), a drain's flag is its *lifetime*, not a one-shot trigger.
// A flag named "drain" or "drain:<room>" both starts a squad-vs-room drain (pick the nearest affordable
// colony, hand the target off via setDrainTarget) AND keeps it alive: the flag is left in place after
// handoff, and the moment it's gone (player deletes it, or it was never resolvable), the next tick's
// pass here clears ColonyMemory.draining via clearDrainTarget, detaching the Drain operation. This
// mirrors why the operation exists at all — the player's flag is the on/off switch, so removing it must
// actually turn drain off, not just stop new colonies from being recruited into an already-running one
// (confirmed live on shard0, 2026-08-05: a removed flag left the colony spawning/draining forever,
// recoverable only via the clearDrainTarget console command). Not wired into SYSTEMS/operationsFor
// (Drain itself isn't a default operation), so this runs as its own call from kernel/tick.ts's tick(),
// independent of the per-colony operation pipeline — same reasoning as attackFlags.ts.
//
// Two passes per tick: (1) every drain flag still resolves/re-affirms its target's handoff, same as
// before, except the flag is NOT removed on success — it stays as the live marker; (2) every colony
// currently draining something gets checked against the current flag set, and any colony whose target
// no longer has a matching flag gets cleared.
//
// Unlike attacking (a list, many concurrent targets per colony), draining is a scalar — ADR 0006 fixes
// exactly one drain target per colony at a time. Two dedup rules follow from that: placing the same
// flag again while a colony is already draining that exact target is a harmless no-op (checked per
// target, same shape as attacking.includes(target)); a colony already draining a *different* target is
// simply not offered up as a sponsor for a new one — pickDrainSponsor only sees colonies with no active
// drain, so an in-progress squad's target can never be silently reassigned by a second flag.

import { pickDrainSponsor } from "./drainSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "drain";

/** Target room for a drain flag — same rule as attackFlags' targetRoomFor: an explicit "drain:<room>"
 * suffix always wins; a bare "drain" flag falls back to its own physical room only when that room has
 * vision (a controller isn't required — an unowned/hostile room still resolves this way). */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as a drain request ("drain" or "drain:<room>"). */
function drainFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// attackFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate (see drainSponsor.ts).
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active drain flag against the current empire,
 * hands the target off to the nearest affordable colony with no drain of its own already in progress,
 * and clears any colony whose drain target no longer has a live flag — the flag's presence IS the
 * operation's lifetime (see file doc). */
export function runDrainFlags(world: Empire): void {
  const flags = drainFlags();
  const liveTargets = new Set(flags.map(targetRoomFor).filter((t): t is string => t !== undefined));

  for (const flag of flags) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`drain flag "${flag.name}": can't tell the target room — place it in-room or name it "drain:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already draining it.
    const alreadySent = world.colonies.some(c => c.snapshot.draining === target);
    if (alreadySent) continue;

    // A colony already draining a *different* target isn't an eligible sponsor for a new one — one
    // active drain per colony at a time (ADR 0006), so an in-progress squad's target never gets silently
    // reassigned by a second flag.
    const eligible = world.colonies.filter(c => c.snapshot.draining === undefined);

    const pick = pickDrainSponsor(eligible, target, routeDistance);
    if (!pick.colony) {
      log.error(`drain flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "setDrainTarget", room: pick.colony.name, target }]);
    log.info(`drain flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this drain, not a one-shot
    // trigger (see file doc) — removing it here would sever that link the instant the handoff succeeds.
  }

  // The flag is gone (removed, or its target changed) for a colony that's still draining: stop it. This
  // is what makes flag removal actually turn a drain off instead of just blocking new recruitment.
  for (const colony of world.colonies) {
    const target = colony.snapshot.draining;
    if (target !== undefined && !liveTargets.has(target)) {
      execute([{ kind: "clearDrainTarget", room: colony.name }]);
      log.info(`drain flag for ${target} is gone: stopping ${colony.name}'s drain`);
    }
  }
}
