// Pure decision logic for a transport creep's live top-off detour — split out of
// behaviors/logisticsRunner.ts so "which nearby candidate wins" and "how wide is the detour budget" are
// testable as plain data-in/data-out functions, without needing Game.* mocking. The runner still owns
// the one thing that can't be pure: the findInRange/findClosestByPath scans that produce the candidate
// lists in the first place (see logisticsRunner.ts's findLiveTopoff).
//
// Why this exists at all: allocate.ts's plan is computed once per tick, when a creep goes idle. A
// provider that looked fine when planLogistics ran can be drained by something outside the logistics
// system (a sweep pickup, a builder self-feeding, another creep entirely) by the time this creep actually
// arrives — while a sibling provider sits right next to it (e.g. a miner's container plus its overflow
// drop pile on/beside the same tile). This is the live, same-tick correction for that gap.

import type { XY } from "../lib/geometry";
import type { NodeRef } from "./types";

// A pile/container must hold at least this much for a same-spot top-off to be worth it — same bar
// targets.ts's WORTHWHILE_FLOOR and graph.ts's DROP_WORTHWHILE_FLOOR use elsewhere.
export const TOPOFF_WORTHWHILE_FLOOR = 50;

// How close a second provider must sit to the one just drained to be worth grabbing on the spot, no
// extra trip. Scales with how much of the haul home is still ahead: right by the home room, almost none
// of a detour is worth it (a fresh, cheap re-plan is one idle tick away — see planLogistics); several
// rooms out, the alternative to a same-tick top-off is walking the WHOLE trip home mostly empty and back
// out again, so a several-tile detour here and now is cheap by comparison. Room-linear-distance is a
// coarse proxy (no live path search per creep per tick — this fires on every drained provider), but it's
// the right shape: 0 near home, growing with real remaining trip length, exactly the deep-remote case
// this whole mechanism exists for. Never below TOPOFF_RANGE_MIN (the adjacent-tile case — a container
// plus its own overflow pile — always qualifies even one room out) or above TOPOFF_RANGE_MAX (an
// unbounded detour on a very deep trip could wander the creep off its route home entirely).
export const TOPOFF_RANGE_MIN = 1;
export const TOPOFF_RANGE_MAX = 5;
export const TOPOFF_RANGE_PER_ROOM = 2; // extra detour tiles tolerated per room of linear distance from home

/** How wide a detour to tolerate, given how many rooms of the trip home remain. */
export function topoffRange(roomsFromHome: number): number {
  return Math.min(TOPOFF_RANGE_MAX, TOPOFF_RANGE_MIN + roomsFromHome * TOPOFF_RANGE_PER_ROOM);
}

// Chebyshev range — matches RoomPosition.getRangeTo, which the runner's live candidate gathering uses.
function chebyshev(a: XY, b: XY): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export interface TopoffCandidate {
  ref: NodeRef;
  pos: XY;
  amount: number;
}

/**
 * Picks the winning top-off candidate: nearest container at/above the worthwhile floor, or — only if no
 * container qualifies — the nearest pile/tombstone/ruin at/above the floor. Containers before drops: a
 * container doesn't decay, so it's the safer bet over a pile another creep might grab first. `exclude`
 * drops the just-drained provider (already known empty — don't re-offer it). Ranks by straight-line
 * range, not path distance — the same trade-off sweep.ts's pickSweepPile makes for the same kind of
 * short-radius opportunistic detour; a path-blocked tile being materially nearer by path than by range is
 * rare and low-stakes at this radius, and the caller re-checks live every tick regardless (a suboptimal
 * pick this tick is corrected or superseded next tick, never a stuck/wrong-forever state).
 */
export function pickTopoff(
  from: XY,
  containers: readonly TopoffCandidate[],
  piles: readonly TopoffCandidate[],
  exclude: Id<_HasId> | undefined
): TopoffCandidate | undefined {
  const nearest = (items: readonly TopoffCandidate[]): TopoffCandidate | undefined =>
    [...items].sort((a, b) => chebyshev(from, a.pos) - chebyshev(from, b.pos))[0];

  const eligibleContainers = containers.filter(c => refId(c.ref) !== exclude && c.amount >= TOPOFF_WORTHWHILE_FLOOR);
  const container = nearest(eligibleContainers);
  if (container) return container;

  const eligiblePiles = piles.filter(p => refId(p.ref) !== exclude && p.amount >= TOPOFF_WORTHWHILE_FLOOR);
  return nearest(eligiblePiles);
}

function refId(ref: NodeRef): Id<_HasId> | undefined {
  return "id" in ref ? (ref.id as unknown as Id<_HasId>) : undefined;
}
