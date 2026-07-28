// Minimal logger, level-gated via Memory.logLevel so it can be flipped from the in-game console (see commands/console.ts).
// Defaults to "error" — unit tests never set Memory.logLevel, so they stay quiet.

const LEVELS = { error: 0, warn: 1, info: 2 } as const;
export type LogLevel = keyof typeof LEVELS;

function currentLevel(): number {
  const configured = typeof Memory !== "undefined" ? Memory.logLevel : undefined;
  return configured !== undefined && configured in LEVELS ? LEVELS[configured] : LEVELS.error;
}

function write(level: LogLevel, msg: string): void {
  if (LEVELS[level] > currentLevel()) return;
  console.log(`[${Game.time}] [${level.toUpperCase()}] ${msg}`);
}

export const log = {
  error(msg: string): void {
    write("error", msg);
  },
  warn(msg: string): void {
    write("warn", msg);
  },
  info(msg: string): void {
    write("info", msg);
  }
};
