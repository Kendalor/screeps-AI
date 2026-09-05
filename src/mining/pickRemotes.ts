// Chooses which remote ROOMS to mine, off scout memory (no live vision needed). Pure — its output is
// cached in ColonyMemory.remotes by a throttled setRemotes intent, so the active room set is stable and
// not re-ranked every tick. Same testable shape as the scout target picker: plain data in, a selection
// out, no Game.*. Prefers each source's real, precomputed PathFinder distance (see ScoutedSource.paths,
// populated by the scouting operation before this ever runs) over the cheap remoteDistanceEstimate
// fallback, so ranking and profitability are judged on the ground truth wherever it's already available.
//
// The unit of selection is the ROOM, not the source: a room is either mined with ALL of its worthwhile
// sources, or not mined at all. There is no partial-room selection, so there's no per-source budget to
// spend or split — entering a room (scouting, eventual reservation) is a one-time cost paid regardless of
// how many of its sources end up mined, so there is nothing to gain by mining only some of them.

import type { XY } from "../lib/geometry";
import { wrapFn } from "../lib/profiler";
import type { RemoteMemory } from "../memory/schema";
import type { ScoutCandidate } from "../snapshot/types";
import { remoteDistanceEstimate } from "./distance";
import { defaultEconomyContext, netEnergy, amortizeClaimer } from "./remoteEconomics";

export interface PickRemotesHome {
  name: string; // home room — never mine our own room as a remote
  storage: XY; // home storage/anchor, the haul endpoint distance is measured from
  energyCapacity: number; // affordability gate: can we spawn a useful miner/claimer body
  spawnCount: number; // colony.spawns.length — the room cap is MAX_REMOTE_ROOMS_PER_SPAWN * this
}

export interface PickRemotesInput {
  candidates: ScoutCandidate[]; // scouted neighbours; each info.sources is the remote-mining input
  home: PickRemotesHome;
  currentlySelected: Id<Source>[]; // sources already committed to Memory.remotes — never dropped here
  // unless reevaluate is set. On a normal call (false), previously-selected rooms are preserved
  // unconditionally and at most one new room is added — today's stable, append-only behavior. On a
  // periodic re-evaluation call (true), every previously-selected room is re-priced and re-ranked
  // alongside fresh candidates as one combined pool, so a room that's gone stale (e.g. a richer room only
  // scouted since, or one that's become unprofitable) can be evicted in favor of a better one. Structures/
  // miners already built for an evicted room are not touched here — that's a separate cleanup concern.
  reevaluate: boolean;
  // Sources already claimed by any OTHER colony's Memory.remotes this tick — a room with even one such
  // source is never selectable here, even on a reevaluate pass, so two colonies never converge on the
  // same room. The caller (Mining's remoteSelection) computes this from the empire's other colonies;
  // this colony's own current selection is handled separately via currentlySelected above, not folded
  // into this set.
  excludedSourceIds: ReadonlySet<Id<Source>>;
  // Consecutive reevaluate passes each currently-selected ROOM has already failed to make the cut on
  // (ColonyMemory.remoteStrikes) — see EVICTION_STRIKES_THRESHOLD below. Absent/0 entries are the common
  // case (a room currently making the cut, or one never selected at all).
  strikes: Partial<Record<string, number>>;
}

export interface PickRemotesResult {
  remotes: RemoteMemory[];
  // Updated strike counts to persist as ColonyMemory.remoteStrikes, keyed by room name — every room
  // considered this pass gets a fresh entry (0 if it made the cut or isn't currently selected,
  // incremented if a reevaluate pass excluded it and it was protected). A room dropped from `strikes`
  // entirely means it's neither selected nor being protected any more — pruned so this can't grow
  // unbounded across a colony's life.
  strikes: Record<string, number>;
}

// Below this, energyCapacity can't build a miner worth sending (RCL2 with all extensions = 550).
const MIN_ENERGY_CAPACITY = 550;

// Room cap: 2 remote rooms per spawn structure the colony owns. A hard backstop on the remote fleet's
// size, scaling with how many spawns exist to staff/replace it — a colony with more spawns can sustain
// more remote rooms' worth of miners/haulers without starving its own local roles.
export const MAX_REMOTE_ROOMS_PER_SPAWN = 2;

// A previously-selected room must fail to make the reevaluate cut this many CONSECUTIVE passes before
// it's actually dropped. Adding a remote room is a sunk-cost bet (its roads/containers only pay back over
// time — see mining.ts's structures() and building.ts's placeAndDemolish, which tear an evicted room's
// already-built home-leg roads down as unwanted the very next tick), so the bar to walk away from one
// should sit higher than the bar to take one on — a candidate that's merely marginally better, or one
// whose edge is a single noisy snapshot, must not immediately unwind that investment. Only gates REMOVAL:
// a genuinely better new room can still join immediately if there's a free slot — hysteresis only
// protects incumbents, it never slows down picking up a find.
const EVICTION_STRIKES_THRESHOLD = 3;

// A room farther than this is never worth remote-mining, full stop — not every scouted room is a
// realistic candidate, and the scouting frontier (Memory.scouting.radius) grows well past this for
// unrelated reasons (general map awareness). Enforced here (not just at the scouting precompute step)
// so a source that somehow got a real path cached anyway still can't be selected past this range.
export const MAX_REMOTE_HOPS = 3;

// One scouted room flattened with its worthwhile sources (each priced at reserved yield) and the room's
// aggregate net worth: the shared unit pickRemotes ranks/admits.
interface RoomCandidate {
  room: string;
  sources: { id: Id<Source>; x: number; y: number; distance: number }[];
  nearestDistance: number; // tiebreak / diagnostic; not the primary ranking key
  netWorth: number; // Σ netEnergy(source, reserved) over the room's sources, minus one shared claimer cost
}

export const pickRemotes = wrapFn(function pickRemotes(input: PickRemotesInput): PickRemotesResult {
  // Empire-wide kill switch (Memory.debugDisableRemoteMining) — see its doc in memory/schema.ts. Lets a
  // scenario isolate a colony's spawn economics from a competing remote-mining fleet without faking
  // scout data/terrain to avoid it being discovered.
  if (typeof Memory !== "undefined" && Memory.debugDisableRemoteMining) return { remotes: [], strikes: {} };

  const { home } = input;

  // Affordability gate: if the colony can't even afford a useful miner body yet, attempt nothing. A hard
  // stop, not something hysteresis should soften — staffing gates downstream (Mining/Reservation) will
  // starve any selection out regardless of what's returned here.
  if (home.energyCapacity < MIN_ENERGY_CAPACITY) return { remotes: [], strikes: {} };

  const maxRemoteRooms = MAX_REMOTE_ROOMS_PER_SPAWN * home.spawnCount;
  if (maxRemoteRooms <= 0) return { remotes: [], strikes: {} };

  const ctx = defaultEconomyContext();

  // Build one RoomCandidate per scouted room: its worthwhile sources (positive netEnergy at reserved
  // rate, ignoring the shared claim cost) and the room's aggregate net worth (their summed netEnergy
  // minus one shared amortizeClaimer — mirrors remoteEconomics.ts's own worthReserving formula). A room
  // with even one source already claimed by a sibling colony is excluded whole — a partial room
  // contradicts the all-or-nothing selection rule.
  const roomCandidates: RoomCandidate[] = [];
  for (const cand of input.candidates) {
    if (cand.room === home.name) continue; // never our own room
    if (cand.type !== "normal") continue; // highways have no sources; keeper rooms need combat (deferred)
    if (cand.distance > MAX_REMOTE_HOPS) continue; // too far to ever be worth mining
    const info = cand.info;
    if (!info) continue; // unscouted — no source data to decide on
    // Owned/reserved by another real player: never selectable, full stop — no threat detection or
    // military capability exists yet to contest it. ScoutInfo.hostile already excludes the Invader NPC's
    // own reservation (see execute.ts's observeRoom), which stays selectable-but-unstaffed instead (see
    // Mining/Reservation's own reservedBy gate, and remoteInvaderAttacks.ts, which actively clears it).
    if (info.hostile) continue;
    if (info.sources.some(src => input.excludedSourceIds.has(src.id))) continue; // a sibling colony holds a source here

    const priced = info.sources.map(src => {
      const cachedPath = src.paths?.[home.name];
      const distance =
        cachedPath !== undefined
          ? cachedPath.length
          : remoteDistanceEstimate({ roomDistance: cand.distance, source: src, storage: home.storage });
      return { id: src.id, x: src.x, y: src.y, distance, net: netEnergy({ distance, reserved: true }, ctx) };
    });
    // Only sources that already stand on their own (ignoring the shared claim cost) count toward the
    // room — a source too far to ever pay off doesn't get to shrink its room-mates' share by
    // "participating" (mirrors the room-worth formula's own logic).
    const worthwhileSources = priced.filter(s => s.net > 0);
    if (worthwhileSources.length === 0) continue;

    const netWorth =
      worthwhileSources.reduce((sum, s) => sum + s.net, 0) - amortizeClaimer(ctx.claimerBodyCost);
    if (netWorth <= 0) continue;

    roomCandidates.push({
      room: cand.room,
      sources: worthwhileSources.map(s => ({ id: s.id, x: s.x, y: s.y, distance: s.distance })),
      nearestDistance: Math.min(...worthwhileSources.map(s => s.distance)),
      netWorth
    });
  }

  // Most-worthwhile first: a richer room wins even if farther away (within the hop limit already
  // enforced above). Nearest-distance is only a diagnostic tiebreak, not the primary ranking key.
  roomCandidates.sort((a, b) => b.netWorth - a.netWorth || a.nearestDistance - b.nearestDistance);

  const selectedRoomNames = new Set(
    roomCandidates
      .filter(rc => rc.sources.some(s => input.currentlySelected.includes(s.id)))
      .map(rc => rc.room)
  );
  // A currently-selected room whose candidate no longer appears at all this pass (e.g. it fell out of
  // scouting radius, or every one of its sources stopped being worthwhile) can't be looked up by name
  // below — but it also can't be re-admitted, so it simply won't appear in `selected`.
  const byRoomName = new Map(roomCandidates.map(rc => [rc.room, rc]));

  let selected: RoomCandidate[];
  let reevaluateStrikes: Record<string, number> | undefined;
  if (input.reevaluate) {
    // Full re-rank: every worthwhile room (previously-selected or not) competes on equal footing,
    // re-priced with whatever distance/economics apply right now. This is the only branch that can drop
    // a previously-selected room.
    const ranked = [...roomCandidates];
    const topRooms = new Set(ranked.slice(0, maxRemoteRooms).map(rc => rc.room));

    // Eviction hysteresis: a previously-selected room that just missed the cut gets protected until it's
    // failed EVICTION_STRIKES_THRESHOLD consecutive reevaluate passes in a row — see the constant's doc
    // for why (an already-built claim is a sunk cost, so removal needs a higher bar than admission).
    const protectedThisPass = new Set<string>();
    const admitted = ranked.filter(rc => topRooms.has(rc.room));
    for (const roomName of selectedRoomNames) {
      if (topRooms.has(roomName)) continue; // made the cut on its own merits — nothing to protect
      const priorStrikes = input.strikes[roomName] ?? 0;
      if (priorStrikes + 1 >= EVICTION_STRIKES_THRESHOLD) continue; // out of grace — let the eviction happen
      // Still worthwhile at all (its economics still pay off), just squeezed out by the cap this pass —
      // a room that's stopped being worthwhile in absolute terms (e.g. now hostile/claimed, or genuinely
      // unprofitable) is never protected regardless of strikes, since it's already absent from
      // roomCandidates and there's nothing left here to re-admit.
      const candidate = byRoomName.get(roomName);
      if (!candidate) continue;
      admitted.push(candidate);
      protectedThisPass.add(roomName);
    }
    // The hard cap always wins, even over a protected incumbent's grace period — hysteresis softens WHEN
    // a room loses its slot, never whether the total fleet size stays bounded. If protection alone would
    // push the count past the cap, bump brand-new admissions first (rooms that were never previously
    // selected at all): they haven't paid any sunk cost yet, so simply waiting one more reevaluate pass
    // costs them nothing an incumbent's already-built claim doesn't also risk. Bumped lowest-net-worth
    // first, since `admitted` is still ranked net-worth-descending up to the topRooms slice.
    if (admitted.length > maxRemoteRooms) {
      const newAdmissions = admitted.filter(rc => !selectedRoomNames.has(rc.room));
      let overflow = admitted.length - maxRemoteRooms;
      const bumped = new Set<string>();
      for (let i = newAdmissions.length - 1; i >= 0 && overflow > 0; i--) {
        bumped.add(newAdmissions[i].room);
        overflow--;
      }
      selected = admitted.filter(rc => !bumped.has(rc.room));
    } else {
      selected = admitted;
    }

    reevaluateStrikes = {};
    for (const rc of selected) {
      // Protected: carries its incremented strike count forward. Made the cut cleanly (whether a
      // longtime incumbent or a brand-new admission): resets to 0 — a room that was once struggling but
      // is now clearly fine again shouldn't still be one bad pass from eviction.
      reevaluateStrikes[rc.room] = protectedThisPass.has(rc.room) ? (input.strikes[rc.room] ?? 0) + 1 : 0;
    }
  } else {
    // Never drop a room we've already committed to, even if it'd fall outside the cap on a re-rank (e.g.
    // richer candidates appeared) — pruning an over-cap colony back down is reevaluate's job (above), not
    // this frequent pass's. Then admit the single most-worthwhile never-selected room, in full, if there's
    // a free slot.
    const kept = roomCandidates.filter(rc => selectedRoomNames.has(rc.room));
    const fresh = roomCandidates.filter(rc => !selectedRoomNames.has(rc.room));
    selected = kept;
    if (fresh.length > 0 && selected.length < maxRemoteRooms) selected.push(fresh[0]);
  }

  const remotes: RemoteMemory[] = selected.map(rc => ({
    room: rc.room,
    sources: rc.sources.map(s => ({ id: s.id, x: s.x, y: s.y, distance: s.distance })),
    reserved: false
  }));

  // Strikes only move on a reevaluate pass (reevaluateStrikes is already fully computed there — see
  // above). The append-only pass never evicts, so it has no basis to reset or increment anything; every
  // currently-selected room just carries its strikes forward unchanged. Either way, a room that's no
  // longer selected at all (fully evicted, or never picked) is simply absent — carrying a stale entry
  // forward for a room that's gone would only grow this map forever.
  const selectedNames = new Set(selected.map(rc => rc.room));
  const strikes: Record<string, number> =
    reevaluateStrikes ??
    Object.fromEntries(Object.entries(input.strikes).filter(([room]) => selectedNames.has(room)) as [string, number][]);

  return { remotes, strikes };
}, "planning:pickRemotes");
