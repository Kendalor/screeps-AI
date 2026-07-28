// In-game console commands, installed onto `global` so they're callable from the Screeps console (e.g. `setLogLevel("info")`).

import type { LogLevel } from "../lib/log";

const VALID: LogLevel[] = ["error", "warn", "info"];

declare global {
  function setLogLevel(level: LogLevel): string;
}

export function installConsoleCommands(): void {
  global.setLogLevel = (level: LogLevel): string => {
    if (!VALID.includes(level)) return `invalid log level "${level}"; use one of: ${VALID.join(", ")}`;
    Memory.logLevel = level;
    return `log level set to "${level}"`;
  };
}
