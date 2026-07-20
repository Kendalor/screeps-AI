// Regenerates the flat goal layout src/layouts/<family>.json from its planner
// export src/layouts/source/<family>-rcl<N>.json. The source is a full RCL8
// bunker in admon84/screeps-room-planner format (absolute coords); the goal is
// the same layout stored anchor-relative with a baked greedy build-order.
// Run after re-exporting from the planner: npm run sync-layouts

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flattenGoal, type PlannerLayout } from "../src/layouts/sync";

const sourceDir = join(__dirname, "../src/layouts/source");
const generatedDir = join(__dirname, "../src/layouts");

// "Base_2-rcl8.json" -> "Base_2.json": the goal is one end-state per family,
// not a per-RCL file, so the RCL suffix is dropped from the generated name.
function goalName(sourceFile: string): string {
  return sourceFile.replace(/-rcl\d+\.json$/i, ".json");
}

for (const file of readdirSync(sourceDir).filter(f => f.endsWith(".json"))) {
  const source = JSON.parse(readFileSync(join(sourceDir, file), "utf8")) as PlannerLayout;
  const goal = flattenGoal(source);
  const outName = goalName(file);
  writeFileSync(join(generatedDir, outName), JSON.stringify(goal, null, 2) + "\n");
  console.log(`synced ${file} -> ${outName}`);
}
