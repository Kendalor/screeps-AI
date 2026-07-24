// THROWAWAY DIAGNOSTIC — delete before commit. Cold-boot forensics: traces per-tick what gets
// spawned, where energy lives (spawn/containers/dropped/creeps), harvest, and controller progress.
import { afterAll, beforeAll, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "cold-boot forensic trace",
  async () => {
    let lastLog = -100;
    const seenCreeps = new Map<string, string>(); // id -> role, logged once when it appears

    await colony.runUntil(
      async () => {
        const objects = await colony.roomObjects();
        const tick = await colony.server.world.gameTime;
        const id = colony.bot.id;

        const creeps = objects.filter((o: any) => o.type === "creep" && o.user === id);
        const mem = (await colony.memory()) as any;
        const creepMem = mem.creeps ?? {};

        // Log any newly-appeared creep with role + body immediately.
        for (const c of creeps) {
          const cid = String(c._id);
          if (!seenCreeps.has(cid)) {
            const role = creepMem[c.name]?.role ?? "?";
            const body = (c.body ?? []).map((p: any) => p.type[0]).join("");
            seenCreeps.set(cid, role);
            console.log(`[SPAWN] tick=${tick} name=${c.name} role=${role} body=${body}`);
          }
        }

        // Focused bootstrap trace for the first 240 ticks: where is it, what does it carry?
        if (tick <= 240 && tick % 15 === 0) {
          const boot = creeps.find((c: any) => creepMem[c.name]?.role === "bootstrap");
          if (boot) {
            const cm = creepMem[boot.name] ?? {};
            const srcs = objects
              .filter((o: any) => o.type === "source")
              .map((s: any) => `(${s.x},${s.y})d=${Math.max(Math.abs(s.x - boot.x), Math.abs(s.y - boot.y))}`);
            const spawn = objects.find((o: any) => o.type === "spawn");
            const near = objects
              .filter(
                (o: any) =>
                  o.type !== "source" &&
                  o.type !== "controller" &&
                  Math.abs(o.x - boot.x) <= 2 &&
                  Math.abs(o.y - boot.y) <= 2
              )
              .map((o: any) => `${o.type}@(${o.x},${o.y})`);
            console.log(
              `[BOOT] tick=${tick} pos=(${boot.x},${boot.y}) fatigue=${boot.fatigue} carry=${boot.store?.energy ?? 0} ` +
                `srcs=${srcs.join(",")} near=${JSON.stringify(near)}`
            );
          }
        }

        if (tick - lastLog >= 25 || tick < 10) {
          lastLog = tick;
          const ctrl = objects.find((o: any) => o.type === "controller");
          const spawns = objects.filter((o: any) => o.type === "spawn");
          const containers = objects.filter((o: any) => o.type === "container");
          const sources = objects.filter((o: any) => o.type === "source");
          const dropped = objects
            .filter((o: any) => o.type === "energy")
            .reduce((s: number, o: any) => s + (o.energy ?? 0), 0);
          const sites = objects.filter((o: any) => o.type === "constructionSite" && o.user === id);

          const roleCounts: Record<string, number> = {};
          let creepEnergy = 0;
          for (const c of creeps) {
            const role = creepMem[c.name]?.role ?? "?";
            roleCounts[role] = (roleCounts[role] ?? 0) + 1;
            creepEnergy += (c.store?.energy as number) ?? 0;
          }

          const spawnEnergy = spawns.reduce((s: number, o: any) => s + ((o.store?.energy as number) ?? 0), 0);
          const containerEnergy = containers.reduce(
            (s: number, o: any) => s + ((o.store?.energy as number) ?? 0),
            0
          );
          const srcEnergy = sources.map((s: any) => s.energy).join(",");

          console.log(
            `[T${tick}] rcl=${ctrl?.level} prog=${ctrl?.progress} | roles=${JSON.stringify(roleCounts)} ` +
              `| E: spawn=${spawnEnergy} cont=${containerEnergy} drop=${dropped} creeps=${creepEnergy} ` +
              `| src=[${srcEnergy}] sites=${sites.length}(${sites.map((s: any) => s.structureType).join(",")}) ` +
              `containers=${containers.length}`
          );
        }
        const ctrl = objects.find((o: any) => o.type === "controller");
        return (ctrl?.level ?? 0) >= 2;
      },
      1500
    );

    const ctrl = await colony.controller();
    console.log(`[RESULT] final rcl=${ctrl.level} progress=${ctrl.progress} totalCreepsEverSpawned=${seenCreeps.size}`);
    const roleTotals: Record<string, number> = {};
    for (const r of seenCreeps.values()) roleTotals[r] = (roleTotals[r] ?? 0) + 1;
    console.log(`[RESULT] roles ever spawned: ${JSON.stringify(roleTotals)}`);
  },
  600_000
);
