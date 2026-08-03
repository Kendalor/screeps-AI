// Scouting fields scouts to survey rooms around a colony so remote mining/expansion has data to decide on.
// Pure — reads the snapshot, returns intents (recordScout, setScoutTarget); execute.ts does the live-room read, route computation, and walking.

import { roleDef } from "../behaviors/roles";
import { needsPassiveRecording, needsScouting, scoutCandidatePool } from "../behaviors/scout";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { NO_PATH_RETRY_AFTER } from "../lib/remotePath";
import { MAX_REMOTE_HOPS } from "../mining/pickRemotes";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Staleness rules live in the behaviour's pure core (shared with the target picker); re-exported for callers/tests.
export { needsScouting, staleAfter } from "../behaviors/scout";

const config = {
  roomsPerScout: 10, // fleet size is ceil(todo / this)
  maxScouts: 3 // hard ceiling so a vast frontier never drowns the spawn queue
} as const;

export class Scouting extends Operation {
  public readonly kind = "scouting";

  /** Scout demand: one per ~roomsPerScout rooms of stale frontier, capped at maxScouts; zero when everything is fresh. */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // The home room (distance 0) is never dispatch-worthy — it's covered by passive recording, not a scout trip.
    const todo = colony.scoutTargets.filter(t => t.room !== colony.name && needsScouting(t, colony.tick));
    if (todo.length === 0) return [];

    const wanted = Math.min(config.maxScouts, Math.ceil(todo.length / config.roomsPerScout));
    log.debugRoom(colony.name, `scouting: stale frontier=${todo.length} (${todo.map(t => t.room).join(", ")}) wanted=${wanted} owned=${this.owned(colony, "scout").length}`);
    return this.fillRole(colony, "scout", wanted, roleDef("scout")!.priority);
  }

  /** Per scout: emit recordScout if standing in a room that needs surveying, and/or setScoutTarget if it needs a new destination.
   * Also passively records any other currently-visible room (visibleRooms) whose record has gone stale
   * by the tighter passive interval — ambient vision from any creep/structure, not just an assigned scout. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const scouts = this.owned(colony, "scout");
    const recorded = new Set<string>();
    const out: Intent[] = [];
    const assignments: { creep: Id<Creep>; candidates: string[] }[] = [];
    for (const scout of scouts) {
      if (this.shouldRecord(colony, scout)) {
        out.push({ kind: "recordScout", room: scout.room });
        recorded.add(scout.room);
      }

      const candidates = this.candidatesFor(colony, scout);
      if (candidates.length > 0) assignments.push({ creep: scout.id, candidates });
    }
    // Bundled into one intent so execute.ts can match every idle scout against its pool jointly (see
    // setScoutTargets' doc) instead of each one independently picking the same nearest room.
    if (assignments.length > 0) out.push({ kind: "setScoutTargets", assignments });

    for (const visible of colony.visibleRooms) {
      if (recorded.has(visible.room)) continue; // already covered by the active pass above this tick
      if (!needsPassiveRecording(visible.info, colony.tick)) continue;
      out.push({ kind: "recordScout", room: visible.room, passive: true });
    }

    out.push(...this.pathPrecompute(colony));
    out.push(...this.potentialPrecompute(colony));

    // Nothing left in range to survey — push the frontier out one ring (execute.ts caps at MAX_SCOUT_RANGE).
    // Home room excluded: it's never dispatch-worthy, so it must not block the frontier from advancing.
    // Deliberately independent of scouts.length: a frontier fully boxed in by fresh/blocked neighbours
    // (e.g. every radius-1 room already surveyed, or filtered out by scoutCandidatesAround's status
    // check) would otherwise never spawn a scout to trigger this in the first place, wedging the radius
    // forever. needsScouting's "never seen" rule already makes this vacuously false before anything's
    // been surveyed, so there's no need to gate on scout count to avoid a premature first advance.
    const nothingToDo = !colony.scoutTargets.some(t => t.room !== colony.name && needsScouting(t, colony.tick));
    if (nothingToDo) {
      log.debugRoom(colony.name, "scouting: frontier fully fresh — advancing scout radius");
      out.push({ kind: "advanceScoutRadius" });
    }

    return out;
  }

  // Emits recordSourcePath for every scouted source within remote-mining range that doesn't have a real
  // path cached yet, so pickRemotes can rank/price on the ground truth instead of the cheap estimate by
  // the time it runs. Bounded to MAX_REMOTE_HOPS: precomputing for the whole scouting frontier (which
  // grows well past remote-mining range for unrelated map-awareness reasons) would waste PathFinder calls
  // on rooms that could never be selected anyway.
  private pathPrecompute(colony: ColonySnapshot): Intent[] {
    if (!colony.anchor) return []; // no anchor yet; nothing to path from (mirrors resolveRemoteRoom's guard)
    const anchor = colony.anchor;
    const out: Intent[] = [];
    for (const cand of colony.scoutTargets) {
      if (cand.room === colony.name) continue;
      if (cand.type !== "normal") continue;
      if (cand.distance > MAX_REMOTE_HOPS) continue;
      const info = cand.info;
      if (!info) continue;
      for (const src of info.sources) {
        if (src.paths?.[colony.name] !== undefined) continue; // already cached
        // A prior attempt already found no route and the backoff hasn't elapsed — skip re-emitting the
        // intent at all (resolvePathToSource re-checks this too, but there's no reason to even dispatch
        // one when this pure planner already knows the answer). See remotePath.ts's NO_PATH_RETRY_AFTER
        // for why an unreachable source needs this: without it, a permanent PathFinder failure has no
        // way to mark itself "already tried" and gets re-searched every tick forever.
        const noPathAt = src.noPathAt?.[colony.name];
        if (noPathAt !== undefined && colony.tick - noPathAt < NO_PATH_RETRY_AFTER) continue;
        out.push({ kind: "recordSourcePath", home: colony.name, room: cand.room, anchor, source: src.id });
      }
    }
    return out;
  }

  // Emits recordPotential for every scouted, anchor-viable, unowned room in range that hasn't had its
  // colonization potential computed yet — the pure map-topology score cached on ScoutInfo.potential (see
  // memory/schema.ts's doc, and colonizationPotential.ts's summarizePotential). Gated on anchor being
  // present (not just anchorChecked): a room with no bunker fit can never be colonized regardless of its
  // neighborhood, so scoring it would be wasted BFS. execute.ts owns the actual describeExits walk and the
  // "is the whole neighborhood scouted yet" readiness check — this planner only decides WHICH rooms are
  // worth attempting, same division of labor as pathPrecompute above.
  private potentialPrecompute(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    for (const cand of colony.scoutTargets) {
      if (cand.room === colony.name) continue;
      if (cand.type !== "normal") continue;
      const info = cand.info;
      if (!info || !info.anchor || info.owner || info.hostile) continue;
      if (info.potentialChecked) continue; // already computed
      // Re-emitted every tick until execute.ts's neighborhood-readiness check passes — cheap (a filter
      // over scoutTargets, no BFS) so there's no need for pathPrecompute's noPathAt-style backoff here.
      out.push({ kind: "recordPotential", room: cand.room });
    }
    return out;
  }

  // Worth recording if the scout's current room is a frontier room whose observation is missing or stale.
  private shouldRecord(colony: ColonySnapshot, scout: SnapCreep): boolean {
    const candidate = colony.scoutTargets.find(t => t.room === scout.room);
    return candidate !== undefined && needsScouting(candidate, colony.tick);
  }

  // The candidate rooms to (re)assign from, or [] to leave it travelling (mid-route reassignment would
  // thrash the route). execute.ts picks the nearest of these via Game.map.findRoute.
  private candidatesFor(colony: ColonySnapshot, scout: SnapCreep): string[] {
    const assigned = scout.memory.scoutTarget;
    // A room the scout was assigned before the frontier walk stopped offering it (e.g. it turned out to
    // sit across a respawn/novice zone boundary — see scoutGraph.ts's status-match filter) no longer
    // appears in scoutTargets at all. Without this check, "still travelling" below leaves a scout
    // permanently pointed at a now-illegal target forever: it can never arrive (the room is walled off),
    // so it never self-clears, and nothing else re-validates an in-flight assignment against the current pool.
    const stillLegal = assigned === undefined || colony.scoutTargets.some(t => t.room === assigned);
    const stillTravelling = assigned !== undefined && assigned !== scout.room;
    if (stillTravelling && stillLegal) {
      log.debugCreep(scout.name, `scouting: still travelling to ${assigned} — not reassigning this tick`);
      return [];
    }
    if (stillTravelling && !stillLegal) {
      log.debugCreep(scout.name, `scouting: assigned target ${assigned} no longer a legal candidate — reassigning`);
    }
    // Exclude the room the scout stands in (recorded this tick, not re-targeted) and the colony's own
    // home room: it's a scoutTargets entry (distance 0) for passive-recording purposes only, and
    // already has permanent vision, so a scout must never be dispatched to sit in it.
    const elsewhere = colony.scoutTargets.filter(t => t.room !== scout.room && t.room !== colony.name);
    const pool = scoutCandidatePool(elsewhere, colony.tick, scout.memory.lastRoom);
    log.debugCreep(
      scout.name,
      pool.length === 0
        ? "scouting: no stale candidate room left to reassign to"
        : `scouting: candidate pool (avoiding lastRoom=${scout.memory.lastRoom ?? "-"}): ${pool.join(", ")}`
    );
    return pool;
  }
}
