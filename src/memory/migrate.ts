// Per-section versioned migrations (docs/rewrite-skeleton.md §3). For now
// only ensures the typed sections exist; version bumps get their own
// migration steps here as schemas evolve — never an all-or-nothing wipe.

export function migrateMemory(): void {
  if (Memory.version === undefined) Memory.version = 1;
  if (!Memory.colonies) Memory.colonies = {};
  if (!Memory.scouting) Memory.scouting = { version: 1 };
  if (!Memory.expansion) Memory.expansion = { version: 1 };
  if (!Memory.stats) Memory.stats = { version: 1 };
}
