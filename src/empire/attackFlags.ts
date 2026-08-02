// Flag-triggered attack entry point — the combat equivalent of colonizeFlags.ts. A flag named "attack" or
// "attack:<room>" is the manual trigger for a one-room strike: pick the nearest affordable colony, hand
// the target off via addAttackTarget, and let the normal per-tick operation pipeline take it from there
// (see colony/index.ts's constructor and operations/attack.ts). Not wired into SYSTEMS/operationsFor
// (Attack itself isn't a default operation), so this runs as its own call from kernel/tick.ts's tick(),
// independent of the per-colony operation pipeline — same reasoning as colonizeFlags.ts.
//
// One flag = one handoff: on success the target is durably recorded (ColonyMemory.attacking, via
// addAttackTarget) and the flag is removed immediately (placing it again re-triggers, e.g. if the whole
// attempt later fails and gets cleaned up). From that tick on, Colony's constructor attaches a real
// Attack operation for the target and it spawns/fights through the completely normal per-tick arbiter —
// this module's job ends at the handoff. On failure (no fitting colony) the flag is left in place and an
// error is logged every tick it's still unresolved, so the player sees why nothing is happening.

import { pickAttackSponsor } from "./attackSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "attack";

/** Target room for an attack flag — same rule as colonizeFlags' targetRoomFor: an explicit
 * "attack:<room>" suffix always wins; a bare "attack" flag falls back to its own physical room only when
 * that room has vision (a controller isn't required — an unowned/hostile room still resolves this way). */
function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Every flag whose name marks it as an attack request ("attack" or "attack:<room>"). */
function attackFlags(): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`));
}

// Real room-graph route length, Infinity when findRoute can't connect the two rooms — same convention
// colonizeFlags.ts's routeDistance uses, not the spawn arbiter's Chebyshev estimate (see attackSponsor.ts).
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Runs once per tick from kernel/tick.ts. Resolves every active attack flag against the current empire,
 * hands the target off to the nearest affordable colony, and clears the flag on success. */
export function runAttackFlags(world: Empire): void {
  for (const flag of attackFlags()) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`attack flag "${flag.name}": can't tell the target room — place it in-room or name it "attack:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already attacking it.
    const alreadySent = world.colonies.some(c => c.snapshot.attacking.includes(target));
    if (alreadySent) continue;

    const pick = pickAttackSponsor(world.colonies, target, routeDistance);
    if (!pick.colony) {
      log.error(`attack flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "addAttackTarget", room: pick.colony.name, target }]);
    log.info(`attack flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    flag.remove();
  }
}
