import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenGoal, type PlannerLayout } from "../../../src/construction/sync";

describe("flattenGoal", () => {
  it("re-anchors absolute planner coords to anchor-relative around the terminal/storage midpoint", () => {
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

    expect(exts.map(e => e.y)).toEqual([-1, -2, -3, -4]);
    const orders = goal.placements.map(p => p.order).sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i));
  });

  it("seeds extension growth on storage, not on the anchor or the spawns", () => {
    // Terminal/storage pushed far apart so the anchor-hugging extension and the
    // storage-hugging one are clearly distinguishable by build order.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 15, y: 25 }],
        storage: [{ x: 35, y: 25 }],
        spawn: [{ x: 25, y: 24 }],
        extension: [
          { x: 26, y: 25 }, // hugs the anchor/spawn
          { x: 34, y: 25 } // hugs storage
        ]
      }
    };

    const exts = flattenGoal(source)
      .placements.filter(p => p.type === "extension")
      .sort((a, b) => a.order - b.order);

    expect(exts.map(e => e.x)).toEqual([9, 1]);
  });

  it("does not let the bunker core act as blob seed, which would order extensions as a ring", () => {
    // Four extensions equidistant from the anchor/core; growth must chain through
    // the extensions themselves rather than treating all four as core-adjacent.
    const source: PlannerLayout = {
      rcl: 8,
      structures: {
        terminal: [{ x: 24, y: 25 }],
        storage: [{ x: 26, y: 25 }],
        spawn: [{ x: 25, y: 24 }, { x: 25, y: 26 }],
        extension: [
          { x: 27, y: 24 }, // beside storage
          { x: 27, y: 26 }, // beside storage
          { x: 23, y: 24 }, // far side
          { x: 23, y: 26 } // far side
        ]
      }
    };

    const exts = flattenGoal(source)
      .placements.filter(p => p.type === "extension")
      .sort((a, b) => a.order - b.order);

    expect(exts.slice(0, 2).every(e => e.x === 2)).toBe(true);
    expect(exts.slice(2).every(e => e.x === -2)).toBe(true);
  });
});

describe("generated goal layouts", () => {
  const sourceDir = join(__dirname, "../../../src/construction/source");
  const generatedDir = join(__dirname, "../../../src/construction");
  const goalName = (f: string) => f.replace(/-rcl\d+\.json$/i, ".json");

  it("stay in sync with src/construction/source/*.json (run `npm run sync-layouts` after editing)", () => {
    const sourceFiles = readdirSync(sourceDir).filter(f => f.endsWith(".json"));
    expect(sourceFiles.length).toBeGreaterThan(0);

    // Collected rather than thrown per-file: a source file mid-edit (e.g. a fresh planner export not
    // yet complete enough to flatten, or not yet run through `npm run sync-layouts` at all) is a real,
    // legitimate transient state — one unhelpful raw TypeError/ENOENT from deep inside flattenGoal/fs
    // shouldn't read like the whole test harness broke. Every file is still checked (one bad file can't
    // hide a real desync in another), and the final message names exactly which files are wrong and why.
    const problems: string[] = [];
    for (const file of sourceFiles) {
      let source: PlannerLayout;
      try {
        source = JSON.parse(readFileSync(join(sourceDir, file), "utf8")) as PlannerLayout;
      } catch (err) {
        problems.push(`${file}: not valid JSON (${(err as Error).message})`);
        continue;
      }

      let expected;
      try {
        expected = flattenGoal(source);
      } catch (err) {
        problems.push(`${file}: can't be flattened yet (${(err as Error).message}) — still being edited?`);
        continue;
      }

      const generatedPath = join(generatedDir, goalName(file));
      if (!existsSync(generatedPath)) {
        problems.push(`${file}: no generated ${goalName(file)} yet — run \`npm run sync-layouts\``);
        continue;
      }
      const generated = JSON.parse(readFileSync(generatedPath, "utf8"));
      if (JSON.stringify(generated) !== JSON.stringify(expected)) {
        problems.push(`${file}: ${goalName(file)} is stale — run \`npm run sync-layouts\``);
      }
    }

    expect(problems).toEqual([]);
  });
});
