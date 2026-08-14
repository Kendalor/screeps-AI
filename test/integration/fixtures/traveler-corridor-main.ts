// Minimal test-only bot: not the production role/interpreter stack. Every tick it drives whichever
// creeps exist by name toward Memory.targets[name], purely to exercise Traveler.travelTo's real
// pathfinding against a real engine (real PathFinder, real terrain, real creep collision) — something
// the hand-rolled unit stubs in test/unit/traveler.test.ts can't reach.
//
// Memory.dualTargets reproduces the interpreter's co-fire pattern (src/empire/creeps.ts's
// coFireBonusStep): two different steps, each independently calling creep.travelTo with its own
// destination, on the same creep in the same tick — e.g. Miner's "harvest" step nudging onto a
// container while its co-fired "transfer" step walks toward a link. Both destinations are unreachable
// from one another's path state, so the second call always sees the first call's leftover _trav.
import "../../../src/lib/traveler";

export function loop(): void {
  const mem = Memory as unknown as {
    targets?: Record<string, { x: number; y: number; roomName: string }>;
    dualTargets?: Record<string, [{ x: number; y: number; roomName: string }, { x: number; y: number; roomName: string }]>;
    log?: Record<string, Array<{ t: number; x: number; y: number; stuck: number }>>;
  };
  const targets = mem.targets ?? {};
  const dualTargets = mem.dualTargets ?? {};
  mem.log ??= {};

  for (const name of Object.keys(targets)) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    const dest = targets[name];
    creep.travelTo(new RoomPosition(dest.x, dest.y, dest.roomName), { range: 0 });

    const trav = (creep.memory as unknown as { _trav?: { state?: number[] } })._trav;
    const stuckCount = trav?.state?.[2] ?? 0;
    (mem.log[name] ??= []).push({ t: Game.time, x: creep.pos.x, y: creep.pos.y, stuck: stuckCount });
  }

  for (const name of Object.keys(dualTargets)) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    const [primary, secondary] = dualTargets[name];
    // Mirrors runOne()'s order: the primary step runs first, then coFireBonusStep runs a step from a
    // different pipeline — both may call travelTo, primary's call landing first each tick.
    creep.travelTo(new RoomPosition(primary.x, primary.y, primary.roomName), { range: 0 });
    creep.travelTo(new RoomPosition(secondary.x, secondary.y, secondary.roomName), { range: 0 });

    const trav = (creep.memory as unknown as { _trav?: { state?: number[] } })._trav;
    const stuckCount = trav?.state?.[2] ?? 0;
    (mem.log[name] ??= []).push({ t: Game.time, x: creep.pos.x, y: creep.pos.y, stuck: stuckCount });
  }
}
