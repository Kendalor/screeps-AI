// Per-section versioned migrations. For now only ensures typed sections exist; version bumps get their own steps here as schemas evolve — never an all-or-nothing wipe.

export function migrateMemory(): void {
  if (Memory.version === undefined) Memory.version = 1;
  if (!Memory.colonies) Memory.colonies = {};
  // The engine creates Memory.rooms lazily, so on a fresh isolate it can be undefined; scouting reads
  // it every tick (Memory.rooms[room].scouted). Ensure it exists so that read never crashes the tick.
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.scouting) Memory.scouting = { radius: 1 };
  if (!Memory.expansion) Memory.expansion = { version: 1 };
  if (!Memory.stats) Memory.stats = { version: 1 };
  if (!Memory.metrics) Memory.metrics = {};
}
