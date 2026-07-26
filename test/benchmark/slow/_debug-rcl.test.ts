import { afterAll, beforeAll, test } from "vitest";
import { BootedColony, bundleBot } from "../../integration/harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "debug: print controller/drop/container state over time",
  async () => {
    await colony.runUntil(
      async () => false,
      2000,
      async tick => {
        if (tick % 100 === 0) {
          const ctrl = await colony.controller();
          const creeps = await colony.creepCount();
          const roles = await colony.rolesAlive();
          const containers = await colony.structures("container");
          const objects = await colony.roomObjects();
          const types = [...new Set(objects.map(o => o.type))].sort();
          console.log(
            `tick ${tick}: rcl=${ctrl.level} progress=${ctrl.progress} creeps=${creeps} roles=${roles.join(",")} containers=${containers.length} types=${types.join(",")}`
          );
          if (tick === 1000) console.log("SAMPLE OBJECTS:", JSON.stringify(objects.filter(o => o.type !== "creep"), null, 2));
        }
      }
    );
  },
  400_000
);
