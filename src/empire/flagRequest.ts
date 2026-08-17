// Shared by every flag-triggered operation entry point (attack/defend/parade/drain/colonize/the
// SingleTargetFlagOperation family): flag discovery by name prefix, route distance for sponsor selection,
// the vision-fallback target-room resolution attack/defend/drain/single-target share verbatim, and the
// flag-color lifetime switch every SingleTargetFlagOperation reads at handoff — findRoute-based, not the
// spawn arbiter's Chebyshev estimate, since a flag target can be unreachable, not just far.
//
// targetRoomFor here is the vision-fallback variant only. colonize's and parade's are deliberately NOT
// this function despite superficially similar names: colonize's requires a controller, parade's is a
// different shape entirely (room+formation, order-independent segments) — false uniformity, not a real
// seam, so each keeps its own.

/** Every flag whose name marks it as a request of this kind ("<prefix>" or "<prefix>:<suffix>"). */
export function flagRequests(prefix: string): Flag[] {
  return Object.values(Game.flags).filter(f => f.name === prefix || f.name.startsWith(`${prefix}:`));
}

/** Target room for a flag whose name is "<prefix>" or "<prefix>:<room>": an explicit suffix always wins;
 * a bare flag falls back to its own physical room only when that room has vision (a controller isn't
 * required — an unowned/hostile room still resolves this way). Shared by attack/defend/drain. */
export function targetRoomFor(flag: Flag): string | undefined {
  const [, suffix] = flag.name.split(":");
  if (suffix) return suffix;
  if (Game.rooms[flag.pos.roomName]) return flag.pos.roomName;
  return undefined;
}

/** Real room-graph route length, Infinity when findRoute can't connect the two rooms at all. */
export function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

import type { OperationLifetime } from "../memory/schema";

/** WHITE => oneShot, RED => constant (the colors chosen for this project — see the operation review this
 * shipped from). Any other color, including the default un-colored placement, falls back to the
 * operation's own `defaultLifetime` rather than erroring — a flag's color is an opt-in override, not a
 * required signal. See memory/schema.ts's OperationLifetime doc for what the two modes mean. */
export function lifetimeOf(flag: Flag, defaultLifetime: OperationLifetime): OperationLifetime {
  if (flag.color === COLOR_WHITE) return "oneShot";
  if (flag.color === COLOR_RED) return "constant";
  return defaultLifetime;
}
