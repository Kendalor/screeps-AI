// THROWAWAY DIAGNOSTIC — delete before commit. Instruments the mining-container scenario
// tick by tick to see census/sites/structures evolve.
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
  await colony.setControllerLevel(3, 0);
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "diagnostic: observe census/sites/structures over time",
  async () => {
    let lastLog = -100;
    await colony.runUntil(
      async () => {
        const tick = await colony.server.world.gameTime;
        if (tick - lastLog >= 10 || tick < 20) {
          lastLog = tick;
          const roles = await colony.rolesAlive();
          const sites = await colony.sites();
          const containers = await colony.structures("container");
          const objects = await colony.roomObjects();
          const creeps = objects.filter((o: any) => o.type === "creep");
          const spawns = objects.filter((o: any) => o.type === "spawn");
          const counts: Record<string, number> = {};
          for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;
          const containerSites = sites.filter((s: any) => s.structureType === "container");
          const anchor = await colony.anchor();
          console.log(
            `[DIAG-9f21] tick=${tick} creeps=${creeps.length} roles=${JSON.stringify(counts)} ` +
              `sites=${JSON.stringify(sites.map((s: any) => ({ x: s.x, y: s.y, t: s.structureType })))} ` +
              `containers=${containers.length} anchor=${JSON.stringify(anchor)} ` +
              `spawnEnergy=${JSON.stringify(spawns.map((s: any) => s.store?.energy))}`
          );
        }
        return false;
      },
      300
    );
    expect(true).toBe(true);
  },
  600_000
);
