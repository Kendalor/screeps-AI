// Empire-scoped automatic colonize target selection. Runs on a long throttle (see kernel/tick.ts) —
// every ~5000 ticks, scan every scouted room, rank the viable ones by colonizePotentialScore, re-derive
// the top candidates' scores live (cached ScoutInfo.potential can be stale on hostility/ownership), and
// spawn a colonizer at the first candidate that also has a fitting sponsor colony. Not cached: this
// module holds no state of its own between throttle ticks — see the project decision ("throttled, not
// cached, every ~5k ticks") — so a fresh full re-rank runs from scratch each time it fires rather than
// persisting a "current pick" across ticks the way pickRemotes stabilizes remote-source selection.

import { colonizePotentialScore } from "../mining/colonizePotentialScore";
import { neighborhoodFullyScouted, summarizePotential } from "../mining/colonizationPotential";
import { MAX_REMOTE_HOPS } from "../mining/pickRemotes";
import { scoutCandidatesAround } from "../snapshot/scoutGraph";
import { gclRoomBudgetOk, pickColonizeSponsor } from "./colonizeSponsor";
import { spawnColonizer } from "./spawnColonizer";
import { log } from "../lib/log";
import type { Empire } from "./index";
import type { ScoutInfo } from "../memory/schema";

// How often the auto-picker fires. Deliberately long: colonizing is a rare, high-commitment decision —
// not a per-tick economy knob like remote-source selection — and each firing can re-derive several
// candidates' live neighborhoods (a real Game.map BFS each), which is not cheap to run often.
export const AUTO_PICK_INTERVAL = 5000;

// Re-derive at most this many top-scoring candidates' live neighborhoods per firing. Bounds the cost of
// a throttle tick regardless of how many rooms have been scouted empire-wide; a candidate that misses the
// cut this pass is simply re-considered (with fresher data) on the next ~5000-tick firing.
const LIVE_RECHECK_TOP_N = 5;

interface Candidate {
  room: string;
  cachedScore: number;
}

function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}

/** Every scouted room that's a real, buildable candidate on cached data alone: has a bunker anchor, has
 * a fully-scored neighborhood, and isn't itself owned/hostile. Excludes nothing about its NEIGHBORS yet
 * (that's what the live re-check below is for) — this is just "is this room worth re-checking at all." */
function cachedCandidates(): Candidate[] {
  const rooms = Memory.rooms ?? {};
  const haveMinerals = knownMinerals();
  const out: Candidate[] = [];
  for (const room in rooms) {
    const info = rooms[room]?.scouted;
    if (!info || !info.anchor || !info.potentialChecked || !info.potential) continue;
    if (info.owner || info.hostile) continue;
    out.push({
      room,
      cachedScore: colonizePotentialScore({ potential: info.potential, ownMineral: info.mineral, haveMinerals })
    });
  }
  return out;
}

function knownMinerals(): Set<MineralConstant> {
  const rooms = Memory.rooms ?? {};
  const out = new Set<MineralConstant>();
  for (const room in Memory.colonies) {
    const mineral = rooms[room]?.scouted?.mineral;
    if (mineral) out.add(mineral);
  }
  return out;
}

/** Rooms already claimed for remote mining by any colony — a colonize target must not overlap one, since
 * claiming a controller and reserving it are mutually exclusive uses of the same room. */
function remoteMiningRooms(): Set<string> {
  const out = new Set<string>();
  for (const room in Memory.colonies) {
    for (const remote of Memory.colonies[room]?.remotes ?? []) out.add(remote.room);
  }
  return out;
}

/** Re-derives one candidate's score off LIVE scouting data (not the cached ScoutInfo.potential), so a
 * neighbor that's since been claimed/reserved/gone hostile since the cache was last computed can't
 * silently keep inflating a stale score. Mirrors execute.ts's recordPotential handler exactly, just run
 * on demand at pick time instead of once-and-cached. */
function liveScore(room: string, ownMineral: ScoutInfo["mineral"], haveMinerals: ReadonlySet<MineralConstant>): number | undefined {
  const neighborhood = scoutCandidatesAround(room, MAX_REMOTE_HOPS);
  if (!neighborhoodFullyScouted(neighborhood)) return undefined; // a neighbor's gone unscouted since caching; skip rather than trust a partial view
  const potential = summarizePotential(neighborhood);
  return colonizePotentialScore({ potential, ownMineral, haveMinerals });
}

/** Runs on AUTO_PICK_INTERVAL. Picks the best current colonize target empire-wide and spawns a colonizer
 * for it, if the GCL room budget allows and some colony can sponsor it. Silent (no candidates / nothing
 * fits) is not an error — it's the normal state between opportunities. */
export function autoPickColonyTarget(world: Empire): void {
  if (Game.time % AUTO_PICK_INTERVAL !== 0) return;
  if (!gclRoomBudgetOk(world.colonies, Game.gcl.level)) return; // no room in the budget; don't even rank

  const excluded = remoteMiningRooms();
  const haveMinerals = knownMinerals();

  const ranked = cachedCandidates()
    .filter(c => !excluded.has(c.room))
    .sort((a, b) => b.cachedScore - a.cachedScore)
    .slice(0, LIVE_RECHECK_TOP_N);

  // Re-score the shortlist live, re-sort by the fresh numbers — a candidate whose neighborhood has
  // decayed since caching (new hostiles, a neighbor claimed by someone) can drop out of contention here
  // even though it looked best on stale data.
  const live = ranked
    .map(c => {
      const info = Memory.rooms?.[c.room]?.scouted;
      const score = liveScore(c.room, info?.mineral, haveMinerals);
      return score === undefined ? undefined : { room: c.room, score };
    })
    .filter((c): c is { room: string; score: number } => c !== undefined)
    .sort((a, b) => b.score - a.score);

  for (const candidate of live) {
    const pick = pickColonizeSponsor(world.colonies, candidate.room, routeDistance, Game.gcl.level);
    if (!pick.colony) continue; // this candidate has no fitting sponsor; try the next-best one

    const outcome = spawnColonizer(pick.colony, candidate.room);
    if (outcome === "spawned") {
      log.info(`auto-picker: colonizing ${candidate.room} (score ${candidate.score.toFixed(1)}) from ${pick.colony.name}`);
    }
    return; // one attempt per firing, win or lose — never cascade through the whole shortlist in one tick
  }
}
