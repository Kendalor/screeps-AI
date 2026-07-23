// Per-section versioned migrations. For now only ensures typed sections exist; version bumps get their own steps here as schemas evolve — never an all-or-nothing wipe.

export function migrateMemory(): void {
  if (Memory.version === undefined) Memory.version = 1;
  if (!Memory.colonies) Memory.colonies = {};
  if (!Memory.scouting) Memory.scouting = { radius: 1 };
  if (!Memory.expansion) Memory.expansion = { version: 1 };
  if (!Memory.stats) Memory.stats = { version: 1 };
  if (!Memory.metrics) Memory.metrics = {};
}
