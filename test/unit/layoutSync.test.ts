import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenGoal, type PlannerLayout } from "../../src/layouts/sync";

describe("flattenGoal", () => {
  it("re-anchors absolute planner coords to anchor-relative around the terminal/storage midpoint", () => {
    // The bunker anchor is the tile between terminal and storage. Placements
    // are stored relative to it so a colony can stamp the layout at any anchor.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 24, y: 25 }],
        storage: [{ x: 26, y: 25 }],
        spawn: [{ x: 25, y: 24 }],
        extension: [{ x: 27, y: 25 }]
      }
    };

    const goal = flattenGoal(source);

    expect(goal.anchor).toEqual({ x: 25, y: 25 });
    expect(goal.placements.find(p => p.type === "terminal")).toMatchObject({ x: -1, y: 0 });
    expect(goal.placements.find(p => p.type === "storage")).toMatchObject({ x: 1, y: 0 });
    expect(goal.placements.find(p => p.type === "spawn")).toMatchObject({ x: 0, y: -1 });
    expect(goal.placements.find(p => p.type === "extension")).toMatchObject({ x: 2, y: 0 });
  });

  it("bakes a greedy nearest-to-blob build-order for extensions, growing outward from storage", () => {
    // A line of extensions stretching away from the core. The build order must
    // fill them nearest-first so the blob grows contiguously, never jumping to a
    // far extension before a nearer one.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 24, y: 25 }],
        storage: [{ x: 26, y: 25 }],
        spawn: [{ x: 25, y: 25 }],
        // deliberately listed far-to-near to prove ordering isn't input order
        extension: [
          { x: 25, y: 21 },
          { x: 25, y: 22 },
          { x: 25, y: 23 },
          { x: 25, y: 24 }
        ]
      }
    };

    const goal = flattenGoal(source);
    const exts = goal.placements
      .filter(p => p.type === "extension")
      .sort((a, b) => a.order - b.order);

    // Ordered nearest-to-anchor (y = -1) outward to (y = -4).
    expect(exts.map(e => e.y)).toEqual([-1, -2, -3, -4]);
    // order values are contiguous and distinct across the whole layout
    const orders = goal.placements.map(p => p.order).sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i));
  });

  it("seeds extension growth on storage, not on the anchor or the spawns", () => {
    // The anchor is the terminal/storage midpoint, so push those two far apart:
    // terminal at x=15, storage at x=35 puts the anchor at x=25 with storage a
    // full 10 tiles east of it. One extension hugs storage, another hugs the
    // anchor. Seeding on the anchor (or on the spawn beside it) would build the
    // anchor-side one first; seeding on storage — where a filler loads — must
    // build the storage-side one first.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 15, y: 25 }], // rel {-10,0}
        storage: [{ x: 35, y: 25 }], // rel {10,0}
        spawn: [{ x: 25, y: 24 }], // rel {0,-1} — beside the anchor
        extension: [
          { x: 26, y: 25 }, // rel {1,0} — hugs the anchor/spawn
          { x: 34, y: 25 } // rel {9,0} — hugs storage
        ]
      }
    };

    const exts = flattenGoal(source)
      .placements.filter(p => p.type === "extension")
      .sort((a, b) => a.order - b.order);

    expect(exts.map(e => e.x)).toEqual([9, 1]);
  });

  it("does not let the bunker core act as blob seed, which would order extensions as a ring", () => {
    // Four extensions equidistant from the anchor, one per diagonal, with the
    // core filling the tiles around the anchor. Growth must chain through the
    // extensions themselves — picking the storage-side one, then its NEIGHBOUR —
    // rather than treating all four as equally adjacent to the core and
    // emitting them as an even ring.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 24, y: 25 }],
        storage: [{ x: 26, y: 25 }],
        spawn: [{ x: 25, y: 24 }, { x: 25, y: 26 }],
        extension: [
          { x: 27, y: 24 }, // rel {2,-1} — beside storage
          { x: 27, y: 26 }, // rel {2,1}  — beside storage
          { x: 23, y: 24 }, // rel {-2,-1} — far side
          { x: 23, y: 26 } // rel {-2,1}  — far side
        ]
      }
    };

    const exts = flattenGoal(source)
      .placements.filter(p => p.type === "extension")
      .sort((a, b) => a.order - b.order);

    // Both storage-side extensions come before both far-side ones.
    expect(exts.slice(0, 2).every(e => e.x === 2)).toBe(true);
    expect(exts.slice(2).every(e => e.x === -2)).toBe(true);
  });
});

describe("generated goal layouts", () => {
  const sourceDir = join(__dirname, "../../src/layouts/source");
  const generatedDir = join(__dirname, "../../src/layouts");
  const goalName = (f: string) => f.replace(/-rcl\d+\.json$/i, ".json");

  it("stay in sync with src/layouts/source/*.json (run `npm run sync-layouts` after editing)", () => {
    const sourceFiles = readdirSync(sourceDir).filter(f => f.endsWith(".json"));
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const file of sourceFiles) {
      const source = JSON.parse(readFileSync(join(sourceDir, file), "utf8")) as PlannerLayout;
      const expected = flattenGoal(source);
      const generated = JSON.parse(readFileSync(join(generatedDir, goalName(file)), "utf8"));
      expect(generated).toEqual(expected);
    }
  });
});
