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

  it("bakes a greedy nearest-to-cluster build-order for extensions, growing outward from the spawns", () => {
    // spawn at anchor; a line of extensions stretching away from it. The build
    // order must fill them nearest-first so the cluster grows contiguously,
    // never jumping to a far extension before a nearer one.
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
