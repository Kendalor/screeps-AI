// Opportunistic en-route pickup: while a hauler travels to its committed gather target (a far
// miner container), it sweeps small dropped/tombstone piles it passes near, so loose energy doesn't
// decay on the ground. Deliberately narrow — the container stays the committed destination; this only
// grabs loose energy within a short detour of the creep's current position.
//
// Why a bounded detour and not a co-fire bonus step: pickup shares the CARRY pipeline with the primary
// gather, so the two can never fire the same tick (canCoFire is false), and travelTo keeps one _trav
// slot per creep — a bonus step is forbidden from travelling lest it clobber the primary path. This
// hook instead *is* the mover for the tick it fires: it walks 1 tile to an adjacent-ish pile, grabs it,
// and next tick the primary gather re-issues its own path to the container. Net cost: a tile or two.

// Max tiles from the creep a pile may sit and still be worth a detour. 2 = one step off the direct
// line, then a step back — negligible against a decaying pile.
const SWEEP_RADIUS = 2;
// A pile must hold at least this much to bother detouring; below it, the walk costs more than the grab.
const SWEEP_FLOOR = 20;

// A dropped Resource exposes .amount; a tombstone exposes .store. Read whichever the pile carries.
function energyOf(pile: Resource | Tombstone): number {
  const asDrop = pile as { amount?: number };
  if (asDrop.amount !== undefined) return asDrop.amount;
  return (pile as Tombstone).store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
}

// The nearest sweep-worthy pile within SWEEP_RADIUS of the creep, or undefined if none is worth it.
// Pure enough to test with a stubbed creep: reads pos.findInRange and the creep's free capacity only.
export function pickSweepPile(creep: Creep): Resource | Tombstone | undefined {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return undefined;

  const drops = creep.pos
    .findInRange(FIND_DROPPED_RESOURCES, SWEEP_RADIUS)
    .filter(d => d.resourceType === RESOURCE_ENERGY && d.amount >= SWEEP_FLOOR);
  const tombs = creep.pos
    .findInRange(FIND_TOMBSTONES, SWEEP_RADIUS)
    .filter(t => t.store.getUsedCapacity(RESOURCE_ENERGY) >= SWEEP_FLOOR);

  const piles: (Resource | Tombstone)[] = [...drops, ...tombs];
  if (piles.length === 0) return undefined;

  // Nearest first: a detour of 1 beats a detour of 2; ties broken by the larger pile.
  return piles.sort(
    (a, b) => creep.pos.getRangeTo(a.pos) - creep.pos.getRangeTo(b.pos) || energyOf(b) - energyOf(a)
  )[0];
}

// Grabs the pile if adjacent, else takes one step toward it. Returns true if it acted (moved or
// picked up) this tick, so the caller can skip the primary pipeline and not double-issue travelTo.
export function sweepEnRoute(creep: Creep): boolean {
  const pile = pickSweepPile(creep);
  if (!pile) return false;

  if (creep.pos.isNearTo(pile.pos)) {
    if ("resourceType" in pile) creep.pickup(pile as Resource);
    else creep.withdraw(pile as Tombstone, RESOURCE_ENERGY);
    return true;
  }
  creep.travelTo(pile.pos);
  return true;
}
