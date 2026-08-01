// Throwaway diagnostic: settler STILL never arrives even after pinning spawnRoom everywhere. Watch
// the full spawn queue and outcome around the claim moment. Delete before committing.
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, scoutableTerrain } from "./harness";
import { seedColony } from "./seed";

const HOME = "W0N1";
const TARGET = "W1N1";
let colony: BootedColony;
const lines: string[] = [];

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: scoutableTerrain(), gcl: 1_000_000 });
  colony.bot.on("console", (log: string[]) => {
    for (const l of log) lines.push(l);
  });
  await colony.runTicks(5);
  await seedColony(colony, { level: 3 });
  await colony.patchMemory(mem => {
    (mem as { logLevel?: string }).logLevel = "info";
  });
  await colony.placeFlag(`colonize:${TARGET}`, HOME, 25, 25);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "diagnostic",
  async () => {
    await colony.runTicks(600);
    // eslint-disable-next-line no-console
    console.log("SETTLER-RELEVANT LOG LINES:\n" + lines.filter(l => /settl|W1N1/i.test(l)).slice(0, 120).join("\n"));
    expect(true).toBe(true);
  },
  180_000
);
