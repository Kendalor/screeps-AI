// Flag-triggered attack entry point — the combat equivalent of colonizeFlags.ts. A flag named "attack" or
// "attack:<room>" is the manual trigger for a one-room strike: pick the nearest affordable colony, hand
// the target off via addAttackTarget, and let the normal per-tick operation pipeline take it from there
// (see colony/index.ts's constructor and operations/attack.ts). Not wired into SYSTEMS/operationsFor
// (Attack itself isn't a default operation), so this runs as its own call from kernel/tick.ts's tick(),
// independent of the per-colony operation pipeline — same reasoning as colonizeFlags.ts.
//
// Unlike a one-shot trigger, the flag's lifetime is now tied to its target's, in both directions (same
// shape as drainFlags.ts/paradeFlags.ts, applied per-target instead of to a scalar): on a successful
// handoff the flag is left in place (not removed) and its name recorded onto the target via
// addAttackTarget's `flag` field (ColonyMemory.attackingFlags); the moment that flag disappears from
// Game.flags, the next tick's second pass here drops just that one target (removeAttackTarget) — the rest
// of a colony's other flag-sponsored/auto-picked targets are untouched, since Attack pools every target
// behind one shared attacker fleet (see attack.ts's header) rather than one operation per target. The
// reverse also holds: when Attack's own completion logic removes a target on its own (room seen clear —
// see attack.ts's intents()), execute.ts prunes attackingFlags for it, and this module's third pass
// notices the now-orphaned flag name and removes the actual flag — so a flag never survives its target's
// natural completion, and a target sponsored by an auto-pick (remoteInvaderAttacks.ts, no flag involved)
// is simply never tracked here at all.
//
// One flag = one handoff, same dedup shape as before: placing the same flag again while its target is
// already being attacked is a harmless no-op.

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
 * hands the target off to the nearest affordable colony (flag left in place as the target's live switch),
 * drops any flag-sponsored target whose flag has since disappeared, and removes any flag whose target has
 * since been dropped by Attack's own completion logic — see file header for the full shape. */
export function runAttackFlags(world: Empire): void {
  const flags = attackFlags();
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
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

    execute([{ kind: "addAttackTarget", room: pick.colony.name, target, flag: flag.name }]);
    log.info(`attack flag "${flag.name}": handed ${target} off to ${pick.colony.name}`);
    // Flag deliberately left in place: it's the live on/off switch for this target now (see file header).
  }

  for (const colony of world.colonies) {
    const mem = Memory.colonies[colony.name];
    const flagsByTarget = mem?.attackingFlags ?? {};
    for (const [target, flagName] of Object.entries(flagsByTarget)) {
      // Reads live Memory.attacking, not colony.snapshot.attacking: the snapshot predates this tick's
      // handoff pass above, so a target added just now by this same call would otherwise misread as
      // "already gone" and have its brand-new flag wrongly removed by the orphan branch below.
      const stillListed = (mem?.attacking ?? []).includes(target);
      if (stillListed && !liveByName.has(flagName)) {
        // The flag is gone but the target is still active: stop attacking it.
        execute([{ kind: "removeAttackTarget", room: colony.name, target }]);
        log.info(`attack flag "${flagName}" is gone: stopping ${colony.name}'s attack on ${target}`);
      } else if (!stillListed) {
        // The target is gone (Attack's own completion logic dropped it) but its flag is still standing:
        // remove the now-orphaned flag so it doesn't linger as a dead marker.
        liveByName.get(flagName)?.remove();
        log.info(`attack target ${target} is gone: removing its flag "${flagName}"`);
      }
    }
  }
}
