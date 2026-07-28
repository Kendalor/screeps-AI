// Scratch debug harness (not committed as a real benchmark) — boots one colony, runs to 3600 ticks,
// and prints per-tick construction-site progress + drop/container energy + transport headcount to
// see exactly why building/upgrading stall together once transport takes over. Delete once done.

import { afterAll, beforeAll, test } from "vitest";
import { BootedColony, bundleBot } from "../integration/harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "debug: construction + drop/container trace",
  async () => {
    await colony.runUntil(
      async () => false,
      3600,
      async tick => {
        if (tick % 50 !== 0) return;
        const objects = await colony.roomObjects();
        const mem = (await colony.memory()) as { creeps?: Record<string, { role?: string }> };
        const creeps = objects.filter(o => o.type === "creep" && o.user === colony.bot.id);
        const roleCounts: Record<string, number> = {};
        for (const c of creeps) {
          const role = mem.creeps?.[c.name as string]?.role ?? "?";
          roleCounts[role] = (roleCounts[role] ?? 0) + 1;
        }

        const sites = objects.filter(o => o.type === "constructionSite" && o.user === colony.bot.id);
        const siteDetail = sites
          .map(s => `${s.structureType}@${s.x},${s.y}=${s.progress}/${s.progressTotal}`)
          .join(" ");

        const drops = objects.filter(o => o.type === "energy");
        const droppedTotal = drops.reduce((s, d) => s + ((d.amount as number) ?? 0), 0);
        const containers = objects.filter(o => o.type === "container");
        const containerTotal = containers.reduce((s, c) => s + ((c.store?.energy as number) ?? 0), 0);

        console.log(
          `tick=${tick} roles=${JSON.stringify(roleCounts)} drops=${droppedTotal} containers=${containerTotal}(n=${containers.length}) sites: ${siteDetail}`
        );
      }
    );
  },
  300_000
);
