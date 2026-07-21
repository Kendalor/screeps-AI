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
const STORAGE = "storage";

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
  // just gets built when its tier unlocks.
  const seeds: GoalPlacement[] = [];
  const extensions: XY[] = [];
  let storage: XY | undefined;
  for (const type of Object.keys(source.structures)) {
    for (const pos of source.structures[type] ?? []) {
      if (type === EXTENSION) {
        extensions.push(rel(pos));
      } else {
        if (type === STORAGE) storage = rel(pos);
        seeds.push({ ...rel(pos), type: type as BuildableStructureConstant, order: 0 });
      }
    }
  }

  const ordered = orderExtensions(extensions, storage ?? origin);

  const placements = [...seeds, ...ordered];
  // Reassign a single contiguous global build-order: seeds first (built as
  // their tier unlocks), then extensions in greedy blob-growth order.
  placements.forEach((p, i) => (p.order = i));
  return { anchor, placements };
}

// Greedy nearest-to-blob, seeded on storage and grown through extensions only.
//
// The seed is the storage tile because that is where a filler loads: the round
// trip it repeats all game is storage -> extension -> storage, so the first
// extensions built should be the ones closest to storage.
//
// The blob then grows extension-to-extension — the rest of the bunker core is
// deliberately NOT part of it. The core (spawns, towers, link, terminal) fills
// nearly every tile within range 1 of the anchor, so including it would make
// "nearest to the blob" equally true of almost every candidate at once; the
// tiebreak would then decide everything and the extensions would come out as an
// even ring around the anchor instead of a cluster. Chaining only through
// extensions keeps a single contiguous blob creeping outward from storage.
//
// Ties (equidistant from the blob) are broken by distance to the seed, so growth
// stays as tight around the load point as the layout allows. This ordering is
// source-independent by construction — it is baked at codegen time, where the
// room's sources are unknown. Biasing toward the sources happens at runtime in
// layouts/goal.ts, which has the room context.
function orderExtensions(extensions: XY[], seed: XY): GoalPlacement[] {
  const remaining = [...extensions];
  const blob: XY[] = [seed];
  const out: GoalPlacement[] = [];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let nearest = Infinity;
      for (const b of blob) {
        const d = range(cand, b);
        if (d < nearest) nearest = d;
      }
      const key: [number, number] = [nearest, range(cand, seed)];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        bestIdx = i;
      }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    blob.push(chosen);
    out.push({ ...chosen, type: EXTENSION as BuildableStructureConstant, order: 0 });
  }
  return out;
}
