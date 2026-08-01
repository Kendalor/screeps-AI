// Spawns a colonizer at `sponsor`, aimed at `target`, through the normal spawn intent path — shared by
// both colonize trigger mechanisms (a placed flag, colonizeFlags.ts; the empire-scoped auto-picker,
// pickColonyTargets.ts) so the spawn mechanics (dedup, affordability, memory shape) live in exactly one
// place. Bypasses the normal per-tick Operation/arbiter pipeline entirely — see operations/colonize.ts's
// header for why Colonize isn't a default operation today.

import { bodyCost } from "../spawn/body";
import { Colonize } from "../operations/colonize";
import { execute } from "../intents/execute";
import type { Colony } from "../colony";

export type SpawnColonizerOutcome =
  | "spawned"
  | "already sponsoring this target"
  | "cannot afford a colonizer"
  | "not enough energy banked right now"
  | "has no idle spawn right now";

/** Attempts to spawn one colonizer at `sponsor`, aimed at `target`. Idempotent: safe to call every tick
 * while a request is pending — Colonize.desiredCreeps()'s own dedup means a second call after a
 * successful spawn (or while one's already en route) simply reports why it did nothing this time. */
export function spawnColonizer(sponsor: Colony, target: string): SpawnColonizerOutcome {
  const request = new Colonize(sponsor.name, target).desiredCreeps(sponsor.snapshot)[0];
  if (!request) {
    const alreadySent = sponsor.snapshot.creeps.some(c => c.role === "colonizer" && c.memory.targetRoom === target);
    return alreadySent ? "already sponsoring this target" : "cannot afford a colonizer";
  }

  const spawn = sponsor.snapshot.spawns.find(s => !s.busy);
  if (!spawn) return "has no idle spawn right now";

  // Colonize.desiredCreeps() only gates on energyCapacity (the room's ceiling) — the normal arbiter
  // (planSpawning) is what checks energyAvailable (what's actually banked right now) before spending a
  // spawn intent, since this bypasses that arbiter entirely, the check has to happen here instead.
  // Without it, spawnCreep is called (and fails with ERR_NOT_ENOUGH_ENERGY) the moment a flag/auto-pick
  // fires, even if the room simply hasn't refilled past its own colonizer's cost yet — and since this
  // function's caller can't observe execute()'s per-intent result (execute() is void, see its own
  // header), the request would otherwise be silently reported as "spawned" and the triggering flag
  // removed despite nothing having actually been created.
  if (bodyCost(request.body) > sponsor.snapshot.energyAvailable) return "not enough energy banked right now";

  // The normal arbiter (planSpawning) stamps targetRoom into memory itself when spawning cross-room
  // (spawning.ts) — bypassing it here means doing that copy by hand, or moveToRoom would have nothing to
  // walk the colonizer toward once it's born in the sponsor room.
  const memory: CreepMemory = { ...request.memory, targetRoom: request.targetRoom };
  execute([{ kind: "spawn", spawn: spawn.id, body: request.body, memory }]);
  return "spawned";
}
