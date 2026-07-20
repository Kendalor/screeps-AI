// Text "dashboard" for watching an integration run live in the terminal, as an
// alternative to a graphical client (docs: the mockup only starts storage +
// engine, never @screeps/backend, and the real Screeps client requires the
// Steam app pointed at a private server — see the screeps-mockup-install
// memory). Streams the bot's console output (log.error/warn/info from
// src/lib/log.ts) as it happens, plus a periodic one-line gauge, so a human
// can watch the same RCL2 climb boot-rcl2.test.ts asserts on.
//
// Lives under test/integration/watch/ specifically so it's excluded from
// vitest.integration.config.ts (which excludes that directory) and only
// picked up by vitest.watch.config.ts — it never runs as part of the normal
// `npm run test:integration`. Run it explicitly with `npm run watch:integration`.

import { test } from "vitest";
import { BootedColony, bundleBot } from "../harness";

const GAUGE_EVERY_TICKS = 25;

// The engine HTML-escapes console output (it's designed to render inside the
// browser client), so decode the common entities for a readable terminal.
const HTML_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#x22;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&"
};
function unescapeConsoleLine(line: string): string {
  return line.replace(/&quot;|&#x22;|&#x27;|&lt;|&gt;|&amp;/g, m => HTML_ENTITIES[m]);
}

test(
  "watch a fresh spawn climb to RCL2",
  async () => {
    const colony = await BootedColony.boot({ botCode: bundleBot() });

    colony.bot.on("console", (log: string[], _results: string[], _userid: string, username: string) => {
      for (const line of log) {
        process.stdout.write(`[${username}] ${unescapeConsoleLine(line)}\n`);
      }
    });

    process.stdout.write(`watching room ${colony.room}\n`);

    try {
      await colony.runUntil(
        async () => (await colony.controller()).level >= 2,
        1200,
        async tick => {
          if (tick % GAUGE_EVERY_TICKS !== 0) return;
          const objects = await colony.roomObjects();
          const ctrl = objects.find(o => o.type === "controller");
          const creeps = objects.filter(o => o.type === "creep").length;
          process.stdout.write(
            `tick ${tick} | RCL ${ctrl?.level ?? 0} (${ctrl?.progress ?? 0}/${ctrl?.progressTotal ?? "-"}) | creeps ${creeps}\n`
          );
        }
      );
    } finally {
      colony.stop();
    }
  },
  180_000
);
