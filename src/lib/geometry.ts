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

// --- world coordinates (cross-room) ----------------------------------------------------------------
// A single global lattice so tile math (a squad's slot offsets, a route's anchor advance) works seamlessly
// across room borders instead of stopping at each room's own 0..49 local space. W/E and N/S mirror around
// the origin the same way roomLinearDistance's axis math encodes at room granularity — here at tile
// granularity. `E0` starts at world x 0..49, `W0` at -50..-1, and so on. Originally squadPath.ts-only
// (its route search always worked in world coordinates); moved here once slotTiles (formation.ts) needed
// the same wrap — a slot offset from an anchor near a border must land in the NEIGHBORING room's local
// coordinates, not produce an out-of-range x/y in the anchor's own room (RoomPosition's constructor throws
// on x/y outside 0..49, which crashed the whole tick's creep loop when a squad's anchor sat at x=49 and a
// trailing slot's +1 offset produced x=50 — confirmed live).

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

export function worldOf(x: number, y: number, room: string): { wx: number; wy: number } {
  const m = ROOM_NAME.exec(room);
  if (!m) throw new Error(`not a room name: ${room}`);
  const ew = m[1];
  const rx = Number(m[2]);
  const ns = m[3];
  const ry = Number(m[4]);
  const wx = ew === "E" ? rx * 50 + x : -(rx + 1) * 50 + x;
  const wy = ns === "S" ? ry * 50 + y : -(ry + 1) * 50 + y;
  return { wx, wy };
}

export function roomAndLocal(wx: number, wy: number): { room: string; x: number; y: number } {
  const rx = Math.floor(wx / 50);
  const ry = Math.floor(wy / 50);
  const x = wx - rx * 50;
  const y = wy - ry * 50;
  const ew = rx >= 0 ? `E${rx}` : `W${-rx - 1}`;
  const ns = ry >= 0 ? `S${ry}` : `N${-ry - 1}`;
  return { room: `${ew}${ns}`, x, y };
}
