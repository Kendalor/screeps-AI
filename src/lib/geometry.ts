// Pure position math over plain {x, y} — planners never touch RoomPosition.

export interface XY {
  x: number;
  y: number;
}

/** Chebyshev distance — the game's "range" metric. */
export function range(a: XY, b: XY): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function closest<T extends XY>(from: XY, candidates: T[]): T | undefined {
  let best: T | undefined;
  let bestRange = Infinity;
  for (const c of candidates) {
    const r = range(from, c);
    if (r < bestRange) {
      best = c;
      bestRange = r;
    }
  }
  return best;
}
