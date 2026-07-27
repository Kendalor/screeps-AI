import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickSweepPile, sweepEnRoute } from "../../src/behaviors/sweep";
import { stubGame } from "../helpers";

// A stubbed hauler: only the fields the sweep reads — store free capacity, pos with findInRange/range
// helpers, and the two action methods we assert against.
interface Pile {
  pos: { x: number; y: number };
  amount?: number; // dropped resource
  resourceType?: string;
  store?: { getUsedCapacity: (r?: string) => number }; // tombstone
}

function pos(x: number, y: number, drops: Pile[], tombs: Pile[]) {
  return {
    x,
    y,
    getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)),
    isNearTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1,
    findInRange: (type: number, range: number) => {
      const src = type === FIND_DROPPED_RESOURCES ? drops : tombs;
      return src.filter(o => Math.max(Math.abs(o.pos.x - x), Math.abs(o.pos.y - y)) <= range);
    }
  };
}

function drop(x: number, y: number, amount: number): Pile {
  return { pos: { x, y }, amount, resourceType: RESOURCE_ENERGY };
}

function tomb(x: number, y: number, amount: number): Pile {
  return { pos: { x, y }, store: { getUsedCapacity: () => amount } };
}

function creepAt(x: number, y: number, opts: { free?: number; drops?: Pile[]; tombs?: Pile[] } = {}) {
  const free = opts.free ?? 100;
  return {
    store: { getFreeCapacity: () => free },
    pos: pos(x, y, opts.drops ?? [], opts.tombs ?? []),
    pickup: vi.fn(),
    withdraw: vi.fn(),
    travelTo: vi.fn()
  } as unknown as Creep & { pickup: ReturnType<typeof vi.fn>; withdraw: ReturnType<typeof vi.fn>; travelTo: ReturnType<typeof vi.fn> };
}

beforeEach(() => stubGame());

describe("pickSweepPile", () => {
  it("returns nothing when the creep is full", () => {
    const creep = creepAt(25, 25, { free: 0, drops: [drop(25, 26, 500)] });
    expect(pickSweepPile(creep)).toBeUndefined();
  });

  it("returns nothing when no pile is within the detour radius", () => {
    const creep = creepAt(25, 25, { drops: [drop(25, 30, 500)] }); // range 5 > SWEEP_RADIUS
    expect(pickSweepPile(creep)).toBeUndefined();
  });

  it("ignores piles below the small floor", () => {
    const creep = creepAt(25, 25, { drops: [drop(25, 26, 5)] }); // < SWEEP_FLOOR
    expect(pickSweepPile(creep)).toBeUndefined();
  });

  it("picks a worthwhile pile within radius", () => {
    const d = drop(25, 26, 500);
    const creep = creepAt(25, 25, { drops: [d] });
    expect(pickSweepPile(creep)).toBe(d);
  });

  it("prefers the nearer pile, then the larger on a tie", () => {
    const near = drop(25, 26, 50); // range 1
    const far = drop(27, 25, 900); // range 2
    const creep = creepAt(25, 25, { drops: [far, near] });
    expect(pickSweepPile(creep)).toBe(near);

    const tieSmall = drop(24, 24, 100); // range 1
    const tieBig = drop(26, 26, 800); // range 1
    const creep2 = creepAt(25, 25, { drops: [tieSmall, tieBig] });
    expect(pickSweepPile(creep2)).toBe(tieBig);
  });

  it("considers tombstones too", () => {
    const t = tomb(25, 26, 300);
    const creep = creepAt(25, 25, { tombs: [t] });
    expect(pickSweepPile(creep)).toBe(t);
  });
});

describe("sweepEnRoute", () => {
  it("picks up an adjacent dropped pile", () => {
    const d = drop(25, 26, 500);
    const creep = creepAt(25, 25, { drops: [d] });
    expect(sweepEnRoute(creep)).toBe(true);
    expect(creep.pickup).toHaveBeenCalledWith(d);
    expect(creep.travelTo).not.toHaveBeenCalled();
  });

  it("withdraws from an adjacent tombstone", () => {
    const t = tomb(25, 26, 300);
    const creep = creepAt(25, 25, { tombs: [t] });
    expect(sweepEnRoute(creep)).toBe(true);
    expect(creep.withdraw).toHaveBeenCalledWith(t, RESOURCE_ENERGY);
  });

  it("steps toward a pile that is near but not adjacent", () => {
    const d = drop(27, 25, 500); // range 2
    const creep = creepAt(25, 25, { drops: [d] });
    expect(sweepEnRoute(creep)).toBe(true);
    expect(creep.travelTo).toHaveBeenCalledWith(d.pos);
    expect(creep.pickup).not.toHaveBeenCalled();
  });

  it("does nothing when there's no worthwhile pile", () => {
    const creep = creepAt(25, 25);
    expect(sweepEnRoute(creep)).toBe(false);
    expect(creep.travelTo).not.toHaveBeenCalled();
    expect(creep.pickup).not.toHaveBeenCalled();
  });
});
