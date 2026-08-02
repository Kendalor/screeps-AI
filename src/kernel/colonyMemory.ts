// Memory.colonies entries outlive the ownership they describe — a lost (or never-actually-owned) room's
// record isn't deleted by anything else, so this prunes it each tick, same pattern as cleanCreepMemory.
// Keyed on controller.my specifically, not merely "room in Game.rooms": scouting/a passing creep grants
// vision (and Game.rooms[x]) without ownership, and colony code must never run off that — see
// snapshot/colony.ts's buildEmpireSnapshot, which already gates snapshot-building the same way. Cleaning
// the memory record too closes the gap for any future reader that isn't as careful about that gate.

export function cleanColonyMemory(): void {
  for (const name in Memory.colonies) {
    if (!Game.rooms[name]?.controller?.my) delete Memory.colonies[name];
  }
}
