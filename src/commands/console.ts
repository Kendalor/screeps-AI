// In-game console commands, installed onto `global` so they're callable from the Screeps console
// (e.g. `setLogLevel("info")`). Each command self-registers into COMMANDS so help() stays accurate
// without a second list to keep in sync.

import { empire } from "../empire";
import type { LogLevel } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import { listColonizeCandidates } from "../empire/pickColonyTargets";

const VALID: LogLevel[] = ["error", "warn", "info"];

const REASON_LABEL: Record<string, string> = {
  remoteMiningOverlap: "already a remote",
  tooClose: "too close to an owned colony",
  tooFar: "too far from any owned colony",
  unreachable: "unreachable"
};

declare global {
  function setLogLevel(level: LogLevel): string;
  function setDebugMetrics(on: boolean): string;
  function spawnLoad(room?: string): string;
  function colonizeTargets(): string;
  function help(): string;
}

// name -> one-line usage/description, printed by help() in registration order.
const COMMANDS: [string, string][] = [];

function register(usage: string, description: string): void {
  COMMANDS.push([usage, description]);
}

export function installConsoleCommands(): void {
  // Idempotent: installConsoleCommands() is called once at module scope in production (see main.ts),
  // but a re-call (e.g. tests re-installing per case) must not duplicate help() entries.
  COMMANDS.length = 0;

  global.setLogLevel = (level: LogLevel): string => {
    if (!VALID.includes(level)) return `invalid log level "${level}"; use one of: ${VALID.join(", ")}`;
    Memory.logLevel = level;
    return `log level set to "${level}"`;
  };
  register("setLogLevel(level)", `set the log level; one of ${VALID.join(", ")}`);

  global.setDebugMetrics = (on: boolean): string => {
    Memory.debugMetrics = on;
    return `debug metrics ${on ? "enabled" : "disabled"}`;
  };
  register("setDebugMetrics(on)", "toggle the right-aligned debug panel (remote repair + remote source status)");

  global.spawnLoad = (room?: string): string => {
    const world = empire(buildEmpireSnapshot());
    const colonies = room ? world.colonies.filter(c => c.name === room) : world.colonies;
    if (colonies.length === 0) return room ? `no colony "${room}"` : "no colonies";
    return colonies
      .map(c => {
        const livingParts = c.snapshot.creeps.reduce((sum, cr) => sum + cr.body.length, 0);
        const requestedParts = c.requestParts();
        const parts = livingParts + requestedParts;
        const capacity = c.snapshot.spawns.length * 500;
        const load = capacity > 0 ? parts / capacity : 0;
        return `${c.name}: load=${(load * 100).toFixed(1)}% parts=${parts} (living=${livingParts} requested=${requestedParts}) capacity=${capacity}`;
      })
      .join("\n");
  };
  register("spawnLoad(room?)", "true spawn load: living + outstanding-request parts / capacity, matching the panel exactly");

  global.colonizeTargets = (): string => {
    const world = empire(buildEmpireSnapshot());
    const listing = listColonizeCandidates(world);
    if (listing.length === 0) return "no colonize candidates known yet — scout more rooms";
    return listing
      .map(c => {
        const dist = Number.isFinite(c.distance) ? c.distance : "-";
        const viability = c.reason ? REASON_LABEL[c.reason] : "viable";
        return `${c.room}: score=${c.score.toFixed(1)} distance=${dist} (${viability})`;
      })
      .join("\n");
  };
  register("colonizeTargets()", "list every cached colonize candidate, sorted by score, with distance and auto-pick viability");

  global.help = (): string => COMMANDS.map(([usage, description]) => `${usage} — ${description}`).join("\n");
  register("help()", "list available console commands");
}
