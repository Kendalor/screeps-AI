// Flag-triggered drain entry point. Unlike attack/colonize, a drain's flag is its *lifetime*, not a
// one-shot trigger: it stays in place after handoff, and the moment it's gone, the next tick's pass here
// clears ColonyMemory.draining via clearDrainTarget — the flag is the on/off switch, so removing it must
// actually turn drain off (confirmed live on shard0, 2026-08-05: a removed flag left the colony
// spawning/draining forever, recoverable only via the clearDrainTarget console command). Not wired into
// SYSTEMS/operationsFor (Drain isn't a default operation), so this runs as its own call from
// kernel/tick.ts, independent of the per-colony pipeline.
//
// Two passes per tick: (1) resolve/re-affirm each drain flag's handoff, without removing it; (2) clear
// any colony whose drain target no longer has a matching flag.
//
// Draining is a scalar, not a list (ADR 0006: exactly one drain target per colony at a time) — so a
// colony already draining a *different* target is excluded from pickDrainSponsor entirely, rather than
// letting an in-progress squad's target be silently reassigned by a second flag.

import { pickDrainSponsor } from "./drainSponsor";
import { flagRequests, routeDistance, targetRoomFor } from "./flagRequest";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { Empire } from "./index";

const FLAG_PREFIX = "drain";

/** Runs once per tick from kernel/tick.ts. Resolves every active drain flag against the current empire,
 * hands the target off to the nearest affordable colony with no drain of its own already in progress,
 * and clears any colony whose drain target no longer has a live flag — the flag's presence IS the
 * operation's lifetime (see file doc). */
export function runDrainFlags(world: Empire): void {
  const flags = flagRequests(FLAG_PREFIX);
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
