// Shared by every flag-triggered operation entry point (attack/defend/parade/drain/colonize): flag
// discovery by name prefix, and route distance for sponsor selection — findRoute-based, not the spawn
// arbiter's Chebyshev estimate, since a flag target can be unreachable, not just far.
//
// targetRoomFor is deliberately NOT here despite looking identical across three files: colonize's
// requires a controller, parade's is a different shape entirely (room+formation, order-independent
// segments) — false uniformity, not a real seam.

/** Every flag whose name marks it as a request of this kind ("<prefix>" or "<prefix>:<suffix>"). */
export function flagRequests(prefix: string): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === prefix || f.name.startsWith(`${prefix}:`));
}

/** Real room-graph route length, Infinity when findRoute can't connect the two rooms at all. */
export function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}
