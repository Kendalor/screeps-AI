// Flag-triggered entry point for the whole SingleTargetFlagOperation family (SimpleBaitTower, Demolish,
// SimpleHeal, AttackController, and any future member — see operations/singleTargetFlagOperation.ts) —
// one generic runner instead of one near-identical *Flags.ts file per kind. Same "flag is the operation's
// lifetime" shape as drainFlags.ts, tied in BOTH directions: a flag named "<kind>", "<kind>:<room>", or
// "<kind>:<room>:<n>" both starts a request (pick the nearest affordable colony, hand the target + creep
// count + resolved lifetime off via setSingleTargetOp, recording the flag's own name onto the entry) AND
// keeps it alive — the flag stays in place after handoff, and the moment it's gone, the next tick's pass
// here clears the entry via clearSingleTargetOp, detaching the operation.
//
// The reverse also holds for a "oneShot" lifetime entry: the operation is a genuine one-shot-per-slot (see
// singleTargetFlagOperation.ts's header), so it can end on its OWN once every slot has been used and
// nothing is left alive, with the flag still standing. When that happens the operation emits
// endSingleTargetOp instead of clearSingleTargetOp — deliberately leaving the entry (and its `flag`) on
// record for one more tick (see that intent's own doc) so this module's second pass below can still find
// the now-orphaned flag and remove it, converging to the exact same terminal state either direction
// produces: no target, no flag.
//
// Two passes per tick, run once per registered kind: (1) every flag of that kind resolves/re-affirms its
// handoff; (2) every colony with a tracked flag for that kind gets checked — flag gone + entry still
// active means the flag was removed (stop the operation); entry gone (wanted reset to 0 by
// endSingleTargetOp, see SingleTargetOpState.wanted's doc) + flag still standing means the operation ended
// itself (remove the orphaned flag).

import { flagRequests, lifetimeOf, routeDistance, targetRoomFor } from "./flagRequest";
import { pickSponsorFor } from "./sponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { SingleTargetFlagOperationClass } from "../operations/singleTargetFlagOperation";
import type { Empire } from "./index";

/** Creep count for a "<kind>:<room>:<n>" flag: an explicit third segment sets how many creeps to spawn;
 * omitted (or not a positive integer) defaults to 1. Every predecessor of this generic runner
 * (SimpleBaitTower's and AttackController's own now-deleted *Flags.ts files) parsed this identically. */
function numCreepsFor(flag: Flag): number {
  const [, , countStr] = flag.name.split(":");
  const n = countStr ? parseInt(countStr, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Runs once per tick from kernel/tick.ts, once per registered kind (see kernel/tick.ts's call sites).
 * Resolves every active flag of `OpClass.kind` against the current empire, hands the target off to the
 * nearest affordable colony with no entry of this kind already at that target, and reconciles every
 * colony's tracked flag against both directions of the lifetime link — see file header for the full shape. */
export function runSingleTargetFlags(world: Empire, OpClass: SingleTargetFlagOperationClass): void {
  const kind = OpClass.kind;
  const flags = flagRequests(kind);
  const liveByName = new Map(flags.map(f => [f.name, f]));

  for (const flag of flags) {
    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`${kind} flag "${flag.name}": can't tell the target room — place it in-room or name it "${kind}:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already running it.
    const alreadySent = world.colonies.some(c => (c.snapshot.singleTargetOps[kind]?.[target]?.wanted ?? 0) > 0);
    if (alreadySent) continue;

    const lifetime = lifetimeOf(flag, OpClass.defaultLifetime);
    if (!OpClass.supportedLifetimes.has(lifetime)) {
      log.error(
        `${kind} flag "${flag.name}": lifetime "${lifetime}" (from flag color) isn't supported by this operation — use one of: ${[
          ...OpClass.supportedLifetimes
        ].join(", ")}`
      );
      continue;
    }

    // A colony already running a *different* target of this kind isn't an eligible sponsor for a new one —
    // one active entry per (kind, colony) at a time, same rule the scalar family always used.
    const eligible = world.colonies.filter(c => !hasActiveEntry(c.snapshot.singleTargetOps[kind]));

    const pick = pickSponsorFor(OpClass, eligible, target, routeDistance);
    if (!pick.colony) {
      log.error(`${kind} flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
      continue;
    }

    const numCreeps = numCreepsFor(flag);
    execute([{ kind: "setSingleTargetOp", room: pick.colony.name, opKind: kind, target, flag: flag.name, lifetime, numCreeps }]);
    log.info(`${kind} flag "${flag.name}": handed ${target} off to ${pick.colony.name} (${numCreeps} creep${numCreeps === 1 ? "" : "s"}, ${lifetime})`);
    // Flag deliberately left in place: it's the live on/off switch for this target (see file header).
  }

  // Reconcile every colony that still has a live entry of this kind on record — reads live Memory, not
  // the (now-stale) snapshot, same reasoning as colonizeFlags.ts's equivalent pass: this must see whatever
  // setSingleTargetOp/endSingleTargetOp the earlier loop or the operation's own intents() already issued
  // this same tick.
  for (const colony of world.colonies) {
    const byTarget = Memory.colonies[colony.name]?.singleTargetOps?.[kind];
    if (!byTarget) continue;

    for (const [target, entry] of Object.entries(byTarget)) {
      const flagName = entry.flag;
      if (!flagName) continue;

      const flagStillLive = liveByName.has(flagName);
      const targetStillActive = entry.wanted > 0;

      if (targetStillActive && !flagStillLive) {
        // The flag was removed but the operation is still running: stop it.
        execute([{ kind: "clearSingleTargetOp", room: colony.name, opKind: kind, target }]);
        log.info(`${kind} flag "${flagName}" is gone: stopping ${colony.name}'s ${kind}`);
      } else if (!targetStillActive && flagStillLive) {
        // The operation ended itself (its creeps died — see singleTargetFlagOperation.ts's header) but the
        // flag is still standing: remove the now-orphaned flag, then drop the now-stale record of it.
        liveByName.get(flagName)?.remove();
        execute([{ kind: "clearSingleTargetOp", room: colony.name, opKind: kind, target }]);
        log.info(`${kind} for "${colony.name}" ended: removing its now-orphaned flag "${flagName}"`);
      }
    }
  }
}

function hasActiveEntry(byTarget: Partial<Record<string, { wanted: number }>> | undefined): boolean {
  if (!byTarget) return false;
  return Object.values(byTarget).some(e => (e?.wanted ?? 0) > 0);
}
