// Flag-triggered drain entry point — the combat equivalent of attackFlags.ts, mirrored file-for-file
// (ADR 0006: "Parallel to Attack, not merged into it"). A flag named "drain" or "drain:<room>" is the
// manual trigger for a squad-vs-room drain: pick the nearest affordable colony, hand the target off via
// setDrainTarget, and let the normal per-tick operation pipeline take it from there (see
// colony/index.ts's constructor and operations/drain.ts). Not wired into SYSTEMS/operationsFor (Drain
// itself isn't a default operation), so this runs as its own call from kernel/tick.ts's tick(),
// independent of the per-colony operation pipeline — same reasoning as attackFlags.ts.
//
// One flag = one handoff: on success the target is durably recorded (ColonyMemory.draining, via
// setDrainTarget) and the flag is removed immediately. From that tick on, Colony's constructor attaches
// a real Drain operation for the target and it spawns/fights through the completely normal per-tick
// arbiter — this module's job ends at the handoff. On failure (no fitting colony) the flag is left in
// place and an error is logged every tick it's still unresolved, so the player sees why nothing is
// happening.
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
 * and clears the flag on success. */
export function runDrainFlags(world: Empire): void {
  for (const flag of drainFlags()) {
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
    flag.remove();
  }
}
