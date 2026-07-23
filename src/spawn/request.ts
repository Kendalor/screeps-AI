// The vocabulary demand is expressed in: a request, its priority scale, and the name a requester
// stamps on the creeps it owns. Types and constants only — the request *functions* deliberately stay
// beside the quota they replaced (see PRD 0005 §7), so nothing here centralises demand.

/**
 * One creep a requester found missing. Always exactly one — a requester short three haulers emits
 * three requests. There is no `role` field: `memory.role` is ground truth, and a second carrier
 * would have nothing enforcing agreement between them.
 *
 * Routing is a request field, not the arbiter's inference: only the requester knows where its creep
 * is *needed* (`targetRoom`), and which is the colony that funds it defaults to that but a remote
 * request may pin it (`spawnRoom`). This is legacy `SpawnEntry`'s `room`/`toPos` pair reduced to
 * what the snapshot architecture actually needs — no persisted queue, no `pause`/`rebuild`.
 */
export interface CreepRequest {
  body: BodyPartConstant[]; // the requester computed it, sized against the budget it chose
  priority: number; // absolute across the empire; higher wins
  memory: CreepMemory; // complete — role, home, op, and anything role-specific
  // Where the creep is needed. The empire arbiter routes the spawn to the nearest spawn-capable
  // colony to here. Defaults to the requesting colony (memory.home), which is every request today —
  // remote/expansion requests will differ. Kept out of memory because it steers spawn *placement*,
  // not the creep's behaviour, and behaviour reads memory.
  targetRoom: string;
  // Hard override: spawn in exactly this colony, skipping the nearest-to-target search. Legacy's
  // manual room pin. Absent means "let the arbiter choose."
  spawnRoom?: string;
}

// Reserved for the wipe restart. Nothing else may reach it: a colony with no creeps has no other
// way out, since every normal quota evaluates to zero.
export const RECOVERY_PRIORITY = 1000;

// Absolute priority scale — economy high, growth low. Gaps are deliberate so a future requester
// slots in without renumbering.
//
// Builder now outranks upgrader (was the reverse): construction unlocks capacity — an extension lets
// every future creep be bigger — so it compounds, while upgrading is a pure sink. Measured: with
// upgraders ahead and uncapped, they ate every drop and two builders finished *zero* extensions in
// 1500 ticks, freezing the room at 300 energy capacity. Feeding construction first breaks that. The
// miner/hauler economy still leads both — nothing to build or upgrade without energy in hand.
export const DEFAULT_PRIORITY = {
  bootstrap: 100,
  miner: 95,
  hauler: 90,
  builder: 65,
  upgrader: 60,
  // Below the whole economy: a scout is a single cheap MOVE and pure future value (vision for remote
  // mining/expansion), so it yields every spawn to a creep that produces or builds now. It still sits
  // above the floor so a settled colony with spare energy does eventually field one.
  scout: 30
} as const;

/**
 * The name a requester stamps on `CreepMemory.op` to claim the creeps it ordered. In stage 2 the
 * value is a string literal with no object behind it; in stage 3 it becomes an operation's own name.
 * Both call this so the two can never drift.
 *
 * Known limit: `kind:room` is unique only while there is at most one operation of a kind per room.
 * Remote mining breaks that, and widening it is stage 3+'s problem.
 */
export function opName(kind: string, room: string): string {
  return `${kind}:${room}`;
}

/**
 * The plain-count satisfaction check, shared by every requester whose demand is "N of this role,
 * and I have M". Emits one request per missing creep, or none when the quota is already met.
 *
 * Each request gets its own copy of the body: they are otherwise one array shared by every request
 * a call produces, so anything that later resizes a body in place would corrupt its siblings.
 *
 * Miner demand deliberately does not use this — its deficit is per source, not a count, which is
 * the whole reason requests replaced counts.
 */
export function fillTo(
  wanted: number,
  have: number,
  body: BodyPartConstant[],
  priority: number,
  memory: CreepMemory
): CreepRequest[] {
  const missing = wanted - have;
  // A role whose body formula yields nothing has no request to make, however short it is.
  if (missing <= 0 || body.length === 0) return [];
  // targetRoom defaults to the creep's home: a count-based requester wants its creeps in its own
  // colony. The per-target requesters that don't (remote mining) don't use fillTo.
  return Array.from({ length: missing }, () => ({
    body: [...body],
    priority,
    memory: { ...memory },
    targetRoom: memory.home
  }));
}
