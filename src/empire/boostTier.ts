// Pure parser for the trailing tier-suffix segment of a boosting-enabled operation's flag/console request
// (epic #61's naming convention, e.g. "Drain:W1N1:4:T3" forces tier 3, "Drain:W1N1:4:T" means greedy
// best-available). This file owns ONLY that one segment's parsing — no stock lookup, no sponsor-pick
// involvement (those live elsewhere per the epic's "Testing Decisions": this is deliberately carved out as
// its own small, exhaustively-testable seam because the format is easy to get subtly wrong). Building the
// rest of Drain/Parade's flag parsing (segments array, room/shape resolution) is out of scope here — see
// drainFlags.ts/paradeFlags.ts for that precedent, which this file's caller will eventually plug into.
//
// Case-sensitive by design: every other flag segment convention in this codebase (ROOM_SEGMENT in
// paradeFlags.ts, drainFlags.ts's prefix) matches exact-case Screeps identifiers (room names, resource
// constants), so "t3" is treated as a typo to reject, not silently accepted.

export type TierRequest =
  | { kind: "forced"; tier: 1 | 2 | 3 }
  | { kind: "greedy" }
  | { kind: "invalid"; reason: string };

const FORCED_TIER: Record<string, 1 | 2 | 3> = { T1: 1, T2: 2, T3: 3 };

/** Parses the tier-suffix segment of a boosting-enabled flag/console request (the trailing ":T3"/":T"
 * segment, or its absence) into a forced tier, greedy best-available, or a parse failure. `segment` is
 * just that one piece — pass `undefined` when the tier position was omitted entirely, which parses the
 * same as a bare "T" (both mean "pick greedily"). Anything else that isn't exactly "T1"/"T2"/"T3"/"T" is
 * rejected with a reason rather than silently falling back to greedy, per the epic's acceptance criteria:
 * a typo here should never be misread as "no preference". */
export function parseTierSegment(segment: string | undefined): TierRequest {
  if (segment === undefined || segment === "T") return { kind: "greedy" };

  const tier = FORCED_TIER[segment];
  if (tier !== undefined) return { kind: "forced", tier };

  return { kind: "invalid", reason: `"${segment}" is not a valid tier segment (expected T1, T2, T3, T, or omitted)` };
}
