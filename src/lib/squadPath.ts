// Footprint-fit route search for a whole squad (ADR 0007). Single-creep pathing is insufficient: a
// candidate anchor tile is only valid if SOME orientation of the ENTIRE formation footprint fits there,
// on walkable terrain, regardless of how many slots are currently occupied. The search runs over an
// augmented (x, y, room, facing) state: an edge either advances the anchor one tile (facing tracks the
// direction moved) or holds the anchor and reforms to a new facing in place (a stationary reform, priced
// as a flat estimate — the real cost is paid when the reform executes). This generalizes across room
// borders with no special case, provided terrain is available for whichever room a candidate tile lands
// in (the TerrainSource, mirroring drainRoomTerrain's vision-independent per-room cache). Pure: plain
// XY/terrain in, path steps out, no Game access.

import { rotateOffset, type Formation } from "./formation";
import type { XY } from "./geometry";

// Vision-independent terrain for a room: 1=walkable, 0=wall, [x*50+y]-indexed (the engine's own layout).
// Undefined for a room with no data on record — treated as fully walkable (fail-open), the same
// convention Drain's own walkability check uses for a snapshot gap.
export type TerrainSource = (room: string) => Uint8Array | undefined;

export interface SquadAnchor extends XY {
  room: string;
}

export interface SquadPathStep {
  anchor: SquadAnchor;
  facing: DirectionConstant;
}

// The 8 unit steps an advance edge can move the anchor. Per ADR 0007 an advance moves the anchor one tile
// AT THE CURRENT FACING — the formation's orientation is held while it slides, and only ever changes via a
// (stationary) reform edge. "Facing tracks direction of travel" is a higher-level behaviour a squad type
// layers on top by choosing its own facing (e.g. Drain faces its advance direction); it is NOT the
// pather's edge model, which must be free to slide an asymmetric footprint down a corridor without
// rotating it into a wall.
const STEP_DELTAS: { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 }
];

const ALL_FACINGS: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

// Flat cost estimate for a hold-and-reform edge — a reform takes a few ticks of shuffling but its exact
// duration isn't tactically significant (ADR 0007), so the search prices it as a small constant penalty
// rather than running the real assignment algorithm just to weight a path edge.
const REFORM_COST = 3;

// A cap so a pathological search (e.g. a huge open room with the goal walled off in a way the footprint
// check only discovers deep in) can't spin forever. Generous — real squad routes are short.
const MAX_EXPANSIONS = 20000;

// --- world coordinates (cross-room) ----------------------------------------------------------------
// A single global lattice so anchor advances and footprint checks work seamlessly across room borders.
// W/E and N/S mirror around the origin the same way roomLinearDistance's axis math encodes at room
// granularity — here at tile granularity. `E0` starts at world x 0..49, `W0` at -50..-1, and so on.

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

function worldOf(x: number, y: number, room: string): { wx: number; wy: number } {
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

function roomAndLocal(wx: number, wy: number): { room: string; x: number; y: number } {
  const rx = Math.floor(wx / 50);
  const ry = Math.floor(wy / 50);
  const x = wx - rx * 50;
  const y = wy - ry * 50;
  const ew = rx >= 0 ? `E${rx}` : `W${-rx - 1}`;
  const ns = ry >= 0 ? `S${ry}` : `N${-ry - 1}`;
  return { room: `${ew}${ns}`, x, y };
}

function walkableWorld(wx: number, wy: number, terrain: TerrainSource): boolean {
  const { room, x, y } = roomAndLocal(wx, wy);
  const t = terrain(room);
  if (!t) return true; // no data on record — fail-open, matching Drain's own convention
  return t[x * 50 + y] === 1;
}

/** Whether the whole formation footprint fits (every slot on walkable terrain) with its anchor at world
 * (wx, wy) facing `facing`. Always checks the FULL formation regardless of current occupancy — a shrunk
 * fit-check could let the squad occupy ground a full-strength formation can't reach (ADR 0007). */
function footprintFits(wx: number, wy: number, facing: DirectionConstant, formation: Formation, terrain: TerrainSource): boolean {
  for (const slot of formation) {
    const r = rotateOffset(slot, facing);
    if (!walkableWorld(wx + r.dx, wy + r.dy, terrain)) return false;
  }
  return true;
}

// A cap on how far out nearestFittingAnchor searches (Chebyshev radius in tiles) before giving up. A squad
// that fits nowhere within this radius is treated the same as "no route" elsewhere in this module — a
// bounded search, not an unbounded spiral, since a genuinely fit-nowhere pocket is a wall-off, not a gap
// that widens if searched further.
const NEAREST_FIT_RADIUS = 15;

/** The nearest anchor tile (by Chebyshev ring, ties broken by search order) and facing where the WHOLE
 * formation footprint fits, searching outward from `from`. Exists for the case a squad's live position no
 * longer fits its own formation at ANY facing — not a bug, an always-possible state (a straggler drifted
 * off under independent movement before joining, a member died and the degraded shape's anchor inference
 * lands somewhere odd, enemy action shoved a member) — the squad must be able to notice "nowhere near me
 * fits either" and walk toward a place that does, rather than reforming forever onto slot tiles that can
 * never all be simultaneously occupied. Returns undefined if nothing within NEAREST_FIT_RADIUS fits (as
 * unreachable as findSquadPath's own "no route" case). Checks `from` itself first (ring 0) so an
 * already-fitting position is returned immediately, same cost as the old direct check it replaces. */
export function nearestFittingAnchor(
  from: SquadAnchor,
  formation: Formation,
  terrain: TerrainSource
): { anchor: SquadAnchor; facing: DirectionConstant } | undefined {
  const s = worldOf(from.x, from.y, from.room);
  for (let radius = 0; radius <= NEAREST_FIT_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only the current ring's perimeter — smaller radii were already tried on earlier iterations.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const wx = s.wx + dx;
        const wy = s.wy + dy;
        for (const facing of ALL_FACINGS) {
          if (!footprintFits(wx, wy, facing, formation, terrain)) continue;
          const { room, x, y } = roomAndLocal(wx, wy);
          return { anchor: { x, y, room }, facing };
        }
      }
    }
  }
  return undefined;
}

interface Node {
  wx: number;
  wy: number;
  facing: DirectionConstant;
  g: number;
  f: number;
  parent?: Node;
}

function stateKey(wx: number, wy: number, facing: DirectionConstant): string {
  return `${wx},${wy},${facing}`;
}

/** A footprint-fit route from `start` (anchor tile + facing) to a tile whose anchor is within range 1 of
 * `goal` (a full footprint fit exactly at the goal isn't required — the squad only needs to reach it).
 * Returns the ordered path of (anchor, facing) steps, or undefined when no route lets the whole
 * formation footprint fit end to end (a corridor too narrow in every orientation, a walled-off goal).
 * Reform edges appear as consecutive steps sharing an anchor tile but differing in facing. */
export function findSquadPath(
  start: { anchor: SquadAnchor; facing: DirectionConstant },
  goal: SquadAnchor,
  formation: Formation,
  terrain: TerrainSource
): SquadPathStep[] | undefined {
  const s = worldOf(start.anchor.x, start.anchor.y, start.anchor.room);
  const g = worldOf(goal.x, goal.y, goal.room);
  const heuristic = (wx: number, wy: number): number => Math.max(Math.abs(wx - g.wx), Math.abs(wy - g.wy));
  const reached = (wx: number, wy: number): boolean => heuristic(wx, wy) <= 0;

  // The start must itself be a valid footprint fit in some facing — otherwise the squad is standing
  // somewhere its full formation can't occupy, and no advance edge from it is meaningful. Fall back to
  // the start facing regardless so a trivial already-at-goal call still returns a step.
  const startFacing = footprintFits(s.wx, s.wy, start.facing, formation, terrain)
    ? start.facing
    : (ALL_FACINGS.find(f => footprintFits(s.wx, s.wy, f, formation, terrain)) ?? start.facing);

  const startNode: Node = { wx: s.wx, wy: s.wy, facing: startFacing, g: 0, f: heuristic(s.wx, s.wy) };

  // Simple array-backed open set (squad routes are short — a full priority queue isn't worth it).
  const open: Node[] = [startNode];
  const best = new Map<string, number>([[stateKey(s.wx, s.wy, startFacing), 0]]);

  let expansions = 0;
  while (open.length > 0) {
    if (++expansions > MAX_EXPANSIONS) return undefined;
    // Pop the lowest-f node.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];

    if (reached(cur.wx, cur.wy)) return reconstruct(cur);

    // A stale entry (a better path to this state was already settled).
    if ((best.get(stateKey(cur.wx, cur.wy, cur.facing)) ?? Infinity) < cur.g) continue;

    // Advance edges: slide the anchor one tile in each of the 8 directions, holding the current facing.
    for (const step of STEP_DELTAS) {
      const nwx = cur.wx + step.dx;
      const nwy = cur.wy + step.dy;
      if (!footprintFits(nwx, nwy, cur.facing, formation, terrain)) continue;
      relax(cur, nwx, nwy, cur.facing, cur.g + 1, open, best, heuristic);
    }

    // Reform edges: hold the anchor, change facing in place (only to a facing whose footprint also fits).
    for (const f of ALL_FACINGS) {
      if (f === cur.facing) continue;
      if (!footprintFits(cur.wx, cur.wy, f, formation, terrain)) continue;
      relax(cur, cur.wx, cur.wy, f, cur.g + REFORM_COST, open, best, heuristic);
    }
  }
  return undefined;
}

function relax(
  parent: Node,
  wx: number,
  wy: number,
  facing: DirectionConstant,
  g: number,
  open: Node[],
  best: Map<string, number>,
  heuristic: (wx: number, wy: number) => number
): void {
  const key = stateKey(wx, wy, facing);
  if ((best.get(key) ?? Infinity) <= g) return;
  best.set(key, g);
  open.push({ wx, wy, facing, g, f: g + heuristic(wx, wy), parent });
}

function reconstruct(end: Node): SquadPathStep[] {
  const steps: SquadPathStep[] = [];
  let n: Node | undefined = end;
  while (n) {
    const { room, x, y } = roomAndLocal(n.wx, n.wy);
    steps.push({ anchor: { x, y, room }, facing: n.facing });
    n = n.parent;
  }
  return steps.reverse();
}
