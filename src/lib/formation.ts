// Pure formation-position math for a fixed 4-creep squad (1 leader + 3 followers) — see ADR 0006's
// "Leader-relative offsets for formation, built as a swappable unit" for why this is hand-rolled and
// isolated behind its own module rather than inline in the Drain operation: heal output requires every
// squad member at range 1 of every other (a strict 2x2 block), not the range-3 HEAL normally allows, so
// loose proximity-following isn't tight enough. No Game object, no creep stubs, no Drain dependency —
// positions and a direction in, target positions out. Recomputed fresh every tick by the caller.

import { type XY } from "./geometry";

// A strict 2x2 block is necessarily grid-axis-aligned (offsets of exactly +-1 on each axis) — Screeps'
// 8-direction compass has diagonals (TOP_RIGHT etc.) whose own unit step is already (+-1, +-1), so
// composing two such steps to build a block corner would land 2 tiles away, breaking mutual range-1.
// The fix isn't to rotate through all 8 compass directions; it's to recognize a 2x2 block only has 4
// distinct orientations in the first place (which corner the leader occupies), and snap the 8 directions
// of travel down to the nearest of those 4 — adjacent compass directions (e.g. TOP and TOP_RIGHT) share
// an orientation, which is correct: there's no finer rotation a strict 2x2 can express.
//
// Each entry is the sign of the offset from the leader to the follower that shares its row/column —
// i.e. the block extends from the leader toward (signX, 0) and (0, signY), with the diagonal follower at
// (signX, signY). Chosen so the block trails behind the leader's direction of travel (e.g. moving TOP,
// the leader is the block's topmost corner and followers sit below/beside it).
const QUADRANT: Record<DirectionConstant, { signX: number; signY: number }> = {
  [TOP]: { signX: 1, signY: 1 },
  [TOP_RIGHT]: { signX: 1, signY: 1 },
  [RIGHT]: { signX: -1, signY: 1 },
  [BOTTOM_RIGHT]: { signX: -1, signY: 1 },
  [BOTTOM]: { signX: -1, signY: -1 },
  [BOTTOM_LEFT]: { signX: -1, signY: -1 },
  [LEFT]: { signX: 1, signY: -1 },
  [TOP_LEFT]: { signX: 1, signY: -1 }
};

/**
 * Computes the 3 follower target positions for a strict 2x2 leader-relative formation block, given the
 * leader's position and its current direction of travel. Returns positions for [beside, behind,
 * behind+beside] the leader (order fixed but otherwise interchangeable — callers assign followers to
 * slots, this module doesn't care which follower goes where) such that leader + all 3 followers form a
 * mutual-range-1 (Chebyshev) block, oriented so the leader is the block's leading corner for the given
 * direction of travel.
 */
export function followerOffsets(leaderPos: XY, direction: DirectionConstant): XY[] {
  const { signX, signY } = QUADRANT[direction];

  const besidePos: XY = { x: leaderPos.x + signX, y: leaderPos.y };
  const behindPos: XY = { x: leaderPos.x, y: leaderPos.y + signY };
  const behindBesidePos: XY = { x: leaderPos.x + signX, y: leaderPos.y + signY };

  return [besidePos, behindPos, behindBesidePos];
}
