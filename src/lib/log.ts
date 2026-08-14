// Minimal logger, level-gated via Memory.logLevel so it can be flipped from the in-game console (see commands/console.ts).
// Defaults to "error" — unit tests never set Memory.logLevel, so they stay quiet.
//
// debugCreep/debugRoom are a SEPARATE gate from logLevel: each call is tagged with a creep name or room
// name, and only prints if that exact tag was opted in via Memory.debugCreeps/debugColonies (see
// commands/console.ts's debugCreep/debugColony). This lets a single creep or colony be traced tick-by-tick
// without either raising the global level (which would flood every colony's info/warn lines) or adding a
// one-off `if (creep.name === "...")` at each call site.

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

function writeDebug(tag: string, msg: string): void {
  console.log(`[${Game.time}] [DEBUG] ${tag}: ${msg}`);
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
  },
  /** Traces one creep, gated on Memory.debugCreeps rather than logLevel — see file header. */
  debugCreep(name: string, msg: string): void {
    if (typeof Memory === "undefined" || !Memory.debugCreeps?.includes(name)) return;
    writeDebug(name, msg);
  },
  /** Traces one colony/room, gated on Memory.debugColonies rather than logLevel — see file header. */
  debugRoom(room: string, msg: string): void {
    if (typeof Memory === "undefined" || !Memory.debugColonies?.includes(room)) return;
    writeDebug(room, msg);
  }
};
