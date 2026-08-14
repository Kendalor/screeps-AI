// Memory.creeps entries outlive the creeps they describe, so this prunes stale ones each tick.

export function cleanCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) delete Memory.creeps[name];
  }
}
