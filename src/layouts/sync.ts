// Flattens a room-planner export (admon84/screeps-room-planner format:
// {rcl, structures:{type:[{x,y}]}} in absolute room coords) into the goal
// layout the planner consumes: a single RCL8 end-state, stored anchor-relative
// with a baked build-order so building.ts can derive the buildable subset at
// any RCL without recomputing the ordering every tick.
//
// Source files live under src/layouts/source/ and are the editable ones —
// re-export from the planner into source/ and run `npm run sync-layouts`.

import { range, type XY } from "../lib/geometry";

// This module is build-time codegen (runs in plain Node via sync-layouts.ts),
// so it cannot use the game's ambient STRUCTURE_* globals — spell the one
// structure type it branches on as its literal value.
const EXTENSION = "extension";

export interface PlannerLayout {
  rcl: number;
  structures: Partial<Record<string, XY[]>>;
}

export interface GoalPlacement extends XY {
  type: BuildableStructureConstant;
  order: number;
}

export interface GoalLayout {
  anchor: XY;
  placements: GoalPlacement[];
}

// The bunker anchor is the tile between terminal and storage (they sit on
// opposite sides of it), which is also the point all spawns cluster around.
function anchorOf(structures: PlannerLayout["structures"]): XY {
  const terminal = structures.terminal?.[0];
  const storage = structures.storage?.[0];
  if (!terminal || !storage) {
    throw new Error("layout must have a terminal and a storage to derive the anchor");
  }
  return { x: (terminal.x + storage.x) / 2, y: (terminal.y + storage.y) / 2 };
}

export function flattenGoal(source: PlannerLayout): GoalLayout {
  const anchor = anchorOf(source.structures);
  const origin: XY = { x: 0, y: 0 }; // anchor is the relative origin

  const rel = (pos: XY): XY => ({ x: pos.x - anchor.x, y: pos.y - anchor.y });

  // Extensions are the one type numerous enough that WHICH ones to build first
  // matters (fill-path length). Everything else is capped-or-nothing per RCL and
  // just gets built when its tier unlocks — those seed the cluster the
  // extensions grow out from.
  const seeds: GoalPlacement[] = [];
  const extensions: XY[] = [];
  for (const type of Object.keys(source.structures)) {
    for (const pos of source.structures[type] ?? []) {
      if (type === EXTENSION) {
        extensions.push(rel(pos));
      } else {
        seeds.push({ ...rel(pos), type: type as BuildableStructureConstant, order: 0 });
      }
    }
  }

  const ordered = orderExtensions(extensions, [origin, ...seeds]);

  const placements = [...seeds, ...ordered];
  // Reassign a single contiguous global build-order: seeds first (built as
  // their tier unlocks), then extensions in greedy cluster-growth order.
  placements.forEach((p, i) => (p.order = i));
  return { anchor, placements };
}

// Greedy nearest-to-cluster: starting from the already-placed structures,
// repeatedly append the extension closest to any placed tile (tie-broken by
// distance to the anchor origin), so the extension blob grows outward
// contiguously and a filler creep's path stays short at every RCL.
function orderExtensions(extensions: XY[], placed: XY[]): GoalPlacement[] {
  const remaining = [...extensions];
  const cluster = [...placed];
  const out: GoalPlacement[] = [];
  const origin: XY = { x: 0, y: 0 };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let nearest = Infinity;
      for (const c of cluster) {
        const d = range(cand, c);
        if (d < nearest) nearest = d;
      }
      const key: [number, number] = [nearest, range(cand, origin)];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        bestIdx = i;
      }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    cluster.push(chosen);
    out.push({ ...chosen, type: EXTENSION as BuildableStructureConstant, order: 0 });
  }
  return out;
}
