// The scout behaviour's pure core: whether a room's data has gone stale, and which rooms are still
// viable to scout next. Picking the *nearest* of those viable rooms needs Game.map.findRoute, which
// only execute.ts can reach — see scoutCandidatePool's note below.

import type { RoomType } from "../lib/roomName";
import { NO_PATH_RETRY_AFTER } from "../lib/remotePath";
import type { ScoutInfo } from "../memory/schema";
import { INVADER_USERNAME } from "../mining/remoteSources";
import type { ScoutCandidate } from "../snapshot/types";

// Re-survey intervals per room type, in ticks; highways carry transient resources so need frequent re-checks.
const STALE_AFTER: Record<RoomType, number> = {
  normal: 100000,
  keeper: 200000,
  highway: 3000,
  intersection: 3000
};

// Re-survey interval for a room last seen held by the Invader NPC — same cadence as a highway, far
// shorter than a normal room's 100k. A core reservation can outlive the core itself (see
// remoteInvaderAttacks.ts's header), so this is what actually gets a scout back for the live vision
// that pruning needs; without it, a room seen once at "normal" cadence is invisible to pruning for the
// entire 100k-tick interval even though it's already flagged as worth clearing. Self-clearing: once a
// revisit finds the core gone, observeRoom drops `owner` and the room falls back to the normal interval.
const INVADER_OWNED_STALE_AFTER = STALE_AFTER.highway;

/** The re-survey interval for a room type, exposed so behaviour, operation and tests agree on "stale". */
export function staleAfter(type: RoomType): number {
  return STALE_AFTER[type];
}

// Passive re-survey interval: any room with ambient vision (no scout dispatched) refreshes its record
// once it's this old, flat across room types — much tighter than active staleAfter since it costs no
// travel, only a skip-if-unstale check plus (usually) a cheap partial re-observe.
const PASSIVE_STALE_AFTER = 1500;

/** Whether a passively-visible room's record is old enough to refresh; mirrors needsScouting's "never seen" rule. */
export function needsPassiveRecording(info: ScoutInfo | undefined, now: number): boolean {
  if (!info || info.tick === undefined) return true;
  return now - info.tick >= PASSIVE_STALE_AFTER;
}

// Whether a room's last-recorded Stronghold core (ScoutInfo.invaderCore) is live right now: deployed
// (either already as of the last observation, or projected to have finished deploying by `now` from its
// own ticksToDeploy countdown) AND not yet projected to have collapsed (from its own
// collapseTicksRemaining countdown, present once deployed — see schema.ts's doc). Without projecting the
// collapse side forward too, a room seen with a live core would stay marked fortified forever: once
// ticksToDeploy is gone (deployed), this used to unconditionally return true with no way back, poisoning
// the room's record for good even long after the real stronghold collapsed and a scout could safely walk
// back in. A level-0 (plain remote-mining-room) core is never fortified — see remoteInvaderAttacks.ts's
// NON_FORTIFIED_CORE_LEVEL — and is deliberately excluded: it reserves a controller but poses no combat
// threat, so it must not gate scouting/routing the way a Stronghold's ramparted defenders do. Shared by
// needsScouting below and execute.ts's/interpreter.ts's route-cost pricing so all three agree on "is this
// room's Stronghold live."
export function hasFortifiedInvaderCore(info: ScoutInfo | undefined, now: number): boolean {
  const core = info?.invaderCore;
  if (!core || core.level <= 0) return false;
  const tick = info!.tick;
  if (core.ticksToDeploy !== undefined) return tick === undefined || now - tick >= core.ticksToDeploy;
  if (core.collapseTicksRemaining !== undefined) return tick === undefined || now - tick < core.collapseTicksRemaining;
  return true; // deployed (or observed before either field existed) with no known collapse time yet
}

/** `now` is passed explicitly (the snapshot's tick) so this stays pure and testable without Game.time. */
export function needsScouting(candidate: ScoutCandidate, now = 0): boolean {
  const info = candidate.info;
  // A room that killed one of our creeps on arrival (see schema.ts's ScoutInfo.lethalAt doc) is never
  // worth dispatching a fresh scout to, even if it's "never seen"/stale by the normal rules — a scout
  // sent there dies before recordScout's intent gets a chance to run, so `tick` may never even update to
  // reflect the visit, which would otherwise leave this permanently "never seen" and re-offered forever.
  // Backoff, not a forever-cache, since a tower can be destroyed later (mirrors noPathFrom's retry window).
  if (info?.lethalAt !== undefined && now - info.lethalAt < NO_PATH_RETRY_AFTER) return false;
  // A Stronghold's fortified core is just as lethal to an unarmed scout as a towered room, and unlike
  // lethalAt there's no need to wait for a death to learn it — the core's own level/deploy timer already
  // says so. No backoff/retry window: a live Stronghold doesn't spontaneously become safe again the way a
  // reputation-hostile owner might leave — only a later re-survey (see the tightened interval below) can
  // ever revise this, by observing the core gone/collapsed.
  if (hasFortifiedInvaderCore(info, now)) return false;
  if (!info || info.tick === undefined) return true; // never physically seen
  // A room last seen with a live (or projected-still-live-when-recorded) fortified core gets the same
  // tightened re-survey cadence as an Invader-owned room, for the identical reason INVADER_OWNED_STALE_AFTER
  // exists (see its own doc): the room's actual state (deployed -> collapsed) can outpace a normal room's
  // 100k/keeper room's 200k-tick interval by orders of magnitude, and hasFortifiedInvaderCore's own collapse
  // projection above is only ever as good as this record's last observation. Without this, a room whose
  // projected collapse has already passed (hasFortifiedInvaderCore now says false) would still wait out the
  // full keeper-room interval before a scout is ever sent back to confirm and refresh the stale record.
  const invaderRelated = info.owner === INVADER_USERNAME || info.invaderCore !== undefined;
  const interval = invaderRelated ? INVADER_OWNED_STALE_AFTER : staleAfter(candidate.type);
  return now - info.tick >= interval;
}

// Rooms still worth dispatching a scout to. Deliberately unordered/undistanced: ranking these by
// "nearest from the scout's current room" needs Game.map.findRoute (real room-graph hops, not a
// Chebyshev estimate that misprices a diagonal room as adjacent when the map only connects N/S/E/W
// neighbours), which only execute.ts can reach — so this stays a pure filter and execute.ts does the
// final pick.
// `avoid` is the room the scout just came from: with only two adjacent stale rooms in range, each is
// forever the other's nearest candidate, so without this a scout ping-pongs between them indefinitely.
// Skipped only when it's the sole remaining candidate, so real progress never stalls.
export function scoutCandidatePool(todo: readonly ScoutCandidate[], now: number, avoid?: string): string[] {
  const open = todo.filter(t => needsScouting(t, now));
  if (open.length === 0) return [];

  const preferred = avoid ? open.filter(t => t.room !== avoid) : open;
  const pool = preferred.length > 0 ? preferred : open;

  return pool.map(t => t.room);
}
