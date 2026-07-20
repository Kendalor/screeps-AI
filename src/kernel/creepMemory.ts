// Standard Screeps housekeeping: Memory.creeps entries outlive the creeps they
// describe, so without this Memory grows by one entry per creep that ever lived
// and eventually costs both serialisation CPU and the 2 MB cap.

export function cleanCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) delete Memory.creeps[name];
  }
}
