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
import { canHostBoosting, pickBoostedSponsor, pickSponsorFor, type BoostRequest } from "./sponsor";
import { pickAvailableTier, resolveCompoundViaBoostActions } from "./boostAvailability";
import { availableEmpireStock, type ColonyEmpireStock } from "./logistics";
import { roleDef } from "../behaviors/roles";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import type { SingleTargetFlagOperationClass } from "../operations/singleTargetFlagOperation";
import type { Empire } from "./index";
import { parseTierSegment, type TierRequest } from "./boostTier";

/** Creep count for a "<kind>:<room>:<n>" flag: an explicit third segment sets how many creeps to spawn;
 * omitted (or not a positive integer) defaults to 1. Every predecessor of this generic runner
 * (SimpleBaitTower's and AttackController's own now-deleted *Flags.ts files) parsed this identically. */
function numCreepsFor(flag: Flag): number {
  const [, , countStr] = flag.name.split(":");
  const n = countStr ? parseInt(countStr, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Optional 4th "<kind>:<room>:<n>:<tier>" segment: a boost tier request for this flag's spawned creeps.
 * Absent segment parses the same as parseTierSegment's own "omitted" case (greedy). An INVALID tier segment
 * (present but not T/T1/T2/T3) is surfaced by returning the invalid result as-is — the caller decides
 * whether to reject the whole flag or fall back; this function itself makes no policy decision. Wired into
 * runSingleTargetFlags below: a "greedy"/"forced" result routes through pickBoostedSponsor and stamps the
 * resolved tier onto setSingleTargetOp; "invalid" rejects the whole flag. */
export function tierRequestFor(flag: Flag): TierRequest {
  const [, , , tierStr] = flag.name.split(":");
  return parseTierSegment(tierStr);
}

/** Runs once per tick from kernel/tick.ts, once per registered kind (see kernel/tick.ts's call sites).
 * Resolves every active flag of `OpClass.kind` against the current empire, hands the target off to the
 * nearest affordable colony with no entry of this kind already at that target, and reconciles every
 * colony's tracked flag against both directions of the lifetime link — see file header for the full shape. */
export function runSingleTargetFlags(world: Empire, OpClass: SingleTargetFlagOperationClass): void {
  const kind = OpClass.kind;
  const flags = flagRequests(kind);
  const liveByName = new Map(flags.map(f => [f.name, f]));

  // Reconcile every colony that still has a live entry of this kind on record BEFORE scanning flags for
  // new assignments below — reads live Memory, not the (now-stale) snapshot, same reasoning as
  // colonizeFlags.ts's equivalent pass: this must see whatever endSingleTargetOp the operation's own
  // intents() already issued this same tick. Ordered first deliberately: a "oneShot" operation that just
  // ended (wanted zeroed, flag still standing — see endSingleTargetOp's own doc) must have its orphaned
  // flag removed here BEFORE the assignment loop below gets a chance to see that same still-standing flag
  // with no active `wanted` behind it and mistake it for a fresh, unclaimed request — re-sponsoring the
  // exact flag this pass was about to clean up and silently restarting the whole cycle forever. Confirmed
  // live: a 5-creep simpleBaitTower run finishing (all 5 spawned and dead) never removed its flag —
  // spawnedCount kept resetting to 0 instead, because the old assignment-first ordering always won the race.
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

  for (const flag of flags) {
    // A flag removed by the reconciliation pass above, this same tick, is no longer live — skip it rather
    // than re-sponsoring the very flag that was just cleaned up (see the ordering comment above).
    if (!liveByName.has(flag.name)) continue;

    const target = targetRoomFor(flag);
    if (!target) {
      log.error(`${kind} flag "${flag.name}": can't tell the target room — place it in-room or name it "${kind}:<room>"`);
      continue;
    }

    // Already handed off for this exact target: don't pick a second sponsor while one's already running it.
    // Reads live Memory (not the snapshot) so it also sees whatever the reconciliation pass above just did.
    const alreadySent = world.colonies.some(
      c => (Memory.colonies[c.snapshot.name]?.singleTargetOps?.[kind]?.[target]?.wanted ?? 0) > 0
    );
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

    // A 4th segment must be PRESENT for this flag to opt into boosting at all — parseTierSegment's own
    // "omitted" case reads identically to a bare "T" (both "greedy") since that file has no opinion on
    // policy (see its own doc), but this call site does: a flag that never mentioned tiers in the first
    // place must take the completely unchanged, pre-existing un-boosted path, never touching
    // canHostBoosting/pickBoostedSponsor — only a flag that explicitly wrote a 4th segment (even a bare
    // "T") is asking for a greedy/forced boost.
    const hasTierSegment = flag.name.split(":")[3] !== undefined;
    const tierRequest = tierRequestFor(flag);
    if (hasTierSegment && tierRequest.kind === "invalid") {
      // A typo on a flag that explicitly included a tier segment — reject the whole flag rather than
      // silently falling back to un-boosted (see tierRequestFor's own doc).
      log.error(`${kind} flag "${flag.name}": ${tierRequest.reason}`);
      continue;
    }

    const numCreeps = numCreepsFor(flag);
    let boostTier: 1 | 2 | 3 | undefined;
    let pick;

    if (hasTierSegment && (tierRequest.kind === "greedy" || tierRequest.kind === "forced")) {
      // A colony that can never host boost labs at all (below RCL6, <3 labs, no terminal) is never a
      // candidate for a BOOSTED sponsor pick regardless of tier stock — filtered before pickBoostedSponsor
      // even runs its own affordability/reachability/stock checks, same "filter the candidate list first"
      // shape `eligible` above already uses for the one-active-entry-per-colony rule.
      const boostEligible = eligible.filter(canHostBoosting);

      const requiredActions = roleDef(OpClass.role)?.boostable ?? [];
      const stocks: ColonyEmpireStock[] = world.colonies.map(c => ({
        colony: c.name,
        storage: Game.rooms[c.name]?.storage?.store,
        terminal: Game.rooms[c.name]?.terminal?.store
      }));
      const reservedOf = (): number => 0; // advisory-only check; nothing reserves here yet
      const boostRequest: BoostRequest = {
        requiredActions,
        tierRequest,
        // A single flat amount-per-action, per pickAvailableTier's own documented simplification (a real
        // per-action/body-aware amount is computeBoostNeeds' job, used below in desiredCreeps() once an
        // actual body is known — this advisory stock check has no body yet, just a role's action list).
        neededAmount: LAB_BOOST_MINERAL,
        resolveCompound: resolveCompoundViaBoostActions,
        colonies: stocks,
        reservedOf
      };

      pick = pickBoostedSponsor(boostEligible, target, OpClass.sponsorConfig.minCost, routeDistance, boostRequest);
      if (!pick.colony) {
        log.error(`${kind} flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
        continue;
      }

      if (tierRequest.kind === "forced") {
        boostTier = tierRequest.tier;
      } else {
        // pickBoostedSponsor's own SponsorPick has no room for which tier a greedy pick actually resolved
        // to — re-run the same tier walk now that a sponsor is confirmed, to learn which one cleared, so
        // desiredCreeps() can stamp the right tier's compounds rather than assuming T3.
        const availableStock = (resource: ResourceConstant): number => availableEmpireStock(stocks, resource, reservedOf);
        const availability = pickAvailableTier(requiredActions, resolveCompoundViaBoostActions, availableStock, LAB_BOOST_MINERAL);
        boostTier = availability.kind === "available" ? availability.tier : undefined;
      }
    } else {
      pick = pickSponsorFor(OpClass, eligible, target, routeDistance);
      if (!pick.colony) {
        log.error(`${kind} flag "${flag.name}": no fitting colony for ${target} (${pick.reason})`);
        continue;
      }
    }

    execute([
      { kind: "setSingleTargetOp", room: pick.colony.name, opKind: kind, target, flag: flag.name, lifetime, numCreeps, boostTier }
    ]);
    log.info(`${kind} flag "${flag.name}": handed ${target} off to ${pick.colony.name} (${numCreeps} creep${numCreeps === 1 ? "" : "s"}, ${lifetime})`);
    // Flag deliberately left in place: it's the live on/off switch for this target (see file header).
  }
}

function hasActiveEntry(byTarget: Partial<Record<string, { wanted: number }>> | undefined): boolean {
  if (!byTarget) return false;
  return Object.values(byTarget).some(e => (e?.wanted ?? 0) > 0);
}
