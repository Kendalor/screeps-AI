// Room-scoped cost matrix — a plain get/set stand-in for PathFinder.CostMatrix that doesn't depend on the
// game runtime, so cost-matrix-building code stays unit-testable without it. Used by
// construction/planner.ts's own matrix builders (construction/roadPathing.ts, its other caller, was
// deleted at gh #55 alongside logistics/index.ts, the only thing it still served).
//
// gh #55: this module used to also export pathDistance/pathDistanceAndStand, real PathFinder.search
// wrappers invoked O(idle creeps x providers/consumers) times per tick by the old logistics allocator
// (logistics/allocate.ts, deleted) — removed as dead code once that allocator's own deletion left them
// with zero callers.

export class RoadCostMatrix {
  private readonly costs = new Uint8Array(2500);

  get(x: number, y: number): number {
    return this.costs[x * 50 + y];
  }

  set(x: number, y: number, cost: number): void {
    this.costs[x * 50 + y] = cost;
  }
}
