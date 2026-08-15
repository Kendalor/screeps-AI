// Vocabulary for expressing demand: a request, its priority scale, and the name a requester stamps on creeps it owns.

/** One creep a requester found missing (always exactly one; no `role` field since `memory.role` is ground truth). */
export interface CreepRequest {
  body: BodyPartConstant[]; // sized against the requester's chosen budget
  priority: number; // absolute across the empire; higher wins
  memory: CreepMemory; // complete — role, home, op, and anything role-specific
  targetRoom: string; // where the creep is needed; arbiter routes to nearest spawn-capable colony, defaults to memory.home
  spawnRoom?: string; // hard override: spawn in exactly this colony; absent means "let the arbiter choose"
  maxSpawnRange?: number; // caps how far the arbiter's nearest-colony search may reach when spawnRoom is absent; absent means unlimited
}

// Reserved for the wipe restart — a colony with no creeps has no other way out, since every normal quota evaluates to zero.
export const RECOVERY_PRIORITY = 1000;

// Per-role default priority lives on each role class (behaviors/roles/*.ts) as a static `priority` field, read via roleDef(role).priority.

/** Name a requester stamps on `CreepMemory.op` to claim the creeps it ordered; both stage 2 and 3 call this so they can't drift. */
export function opName(kind: string, room: string): string {
  return `${kind}:${room}`;
}

/** Plain-count satisfaction check: emits one request per missing creep. Miner demand doesn't use this — its deficit is per source. */
export function fillTo(
  wanted: number,
  have: number,
  body: BodyPartConstant[],
  priority: number,
  memory: CreepMemory
): CreepRequest[] {
  const missing = wanted - have;
  if (missing <= 0 || body.length === 0) return []; // no body formula, no request
  // targetRoom defaults to the creep's home; per-target requesters (remote mining) don't use fillTo.
  // spawnRoom is pinned to that same home: every fillTo caller is a colony-scoped operation whose
  // creep is meant to be spawned by that colony alone, never opportunistically routed through a
  // different colony's spawn by planSpawning's "nearest colony that can afford it" fallback (see
  // empire/spawning.ts's pickPurse) — that fallback exists for genuinely cross-colony demand
  // (Colonize's colonizer/settler, which build their own request by hand and deliberately omit
  // spawnRoom instead). Without this pin, a colony with no spawn of its own yet (e.g. a freshly
  // colonized room still being bootstrapped) could have ITS local demand silently fulfilled from a
  // totally unrelated colony's budget/spawns, starving that colony's own real needs (or in the
  // colonize case, starving the settler that was supposed to build this room's own first spawn).
  return Array.from({ length: missing }, () => ({
    body: [...body],
    priority,
    memory: { ...memory },
    targetRoom: memory.home,
    spawnRoom: memory.home
  }));
}
