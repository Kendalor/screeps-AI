// Chooses which remote sources to mine, nearest-first, off scout memory (no live vision needed). Pure —
// its output is cached in ColonyMemory.remotes by a throttled setRemotes intent, so the active source set
// is stable and not re-ranked every tick. Same testable shape as the scout target picker: plain data in,
// a selection out, no Game.*. Prefers each candidate's real, precomputed PathFinder distance (see
// ScoutedSource.paths, populated by the scouting operation before this ever runs) over the cheap
// remoteDistanceEstimate fallback, so ranking and profitability are judged on the ground truth wherever
// it's already available.

import type { XY } from "../lib/geometry";
import { wrapFn } from "../lib/profiler";
import type { RemoteMemory } from "../memory/schema";
import type { ScoutCandidate } from "../snapshot/types";
import { remoteSourceLoadParts } from "./load";
import { remoteDistanceEstimate } from "./distance";
import { defaultEconomyContext, netEnergy, amortizeClaimer } from "./remoteEconomics";

export interface PickRemotesHome {
  name: string; // home room — never mine our own room as a remote
  storage: XY; // home storage/anchor, the haul endpoint distance is measured from
  energyCapacity: number; // affordability gate: can we spawn a useful miner/claimer body
  // Capacity gate: same colony-fraction formula as the metrics panel's spawn `load` (parts /
  // (spawns * PARTS_PER_SPAWN), see colony/metrics.ts) — comparable numbers, not a separate concept.
  spawnLoad: number; // current colony-wide fraction (0..1+) before any new remote source
  spawnCapacity: number; // parts these spawns can sustain (spawns.length * PARTS_PER_SPAWN); 0 disables selection
  // Parts NOT attributable to any currently-selected remote source (local miners/haulers/upgraders/etc,
  // plus the fixed local-hauling share of transport) — spawnLoad * spawnCapacity minus the summed
  // remoteSourceLoadParts of every currently-selected source. reevaluate's budget is charged against
  // (MAX_SPAWN_LOAD * spawnCapacity - localLoadParts), not the bare ceiling: spending the whole ceiling
  // on remote-source estimates while ignoring what local roles already consume let a colony whose local
  // load alone was already near/at the ceiling keep "fitting" a full remote fleet under cheap per-source
  // estimates, even though the real (pooled, Logistics-sized) transport fleet those sources drove had
  // already pushed total load well past 100%.
  localLoadParts: number;
}

export interface PickRemotesInput {
  candidates: ScoutCandidate[]; // scouted neighbours; each info.sources is the remote-mining input
  home: PickRemotesHome;
  currentlySelected: Id<Source>[]; // sources already committed to Memory.remotes — never dropped here
  // unless reevaluate is set, and at most one never-before-selected room's worth of sources is added per
  // call, so a burst of newly-scouted rooms can't all commit their whole remote-mining fleet in the same
  // throttle tick.
  // On a normal call (false), previously-selected sources are preserved unconditionally and at most one
  // new room's sources are added — today's stable, append-only behavior. On a periodic re-evaluation call
  // (true), every previously-selected source is re-priced and re-ranked alongside fresh candidates as one
  // combined pool, so a source that's gone stale (e.g. a nearer room only scouted since, or one that's
  // become unprofitable) can be evicted in favor of a better one. Structures/miners already built for an
  // evicted source are not touched here — that's a separate cleanup concern.
  reevaluate: boolean;
}

// Below this, energyCapacity can't build a miner worth sending (RCL2 with all extensions = 550).
const MIN_ENERGY_CAPACITY = 550;

// Cap on total selected remote sources — a hard backstop against an unbounded remote fleet even if the
// spawn-load gate below is somehow satisfied every time (e.g. a very large spawn count). Nearest-first,
// so the cap keeps the cheapest energy.
const MAX_REMOTE_SOURCES = 6;

// Never select a source that would push the colony's spawn load (see colony/metrics.ts's `load`: parts /
// (spawns * PARTS_PER_SPAWN)) past this fraction — the spawn(s) must stay able to keep up with local
// roles, not just the remote fleet. Same 0..1 units as the metrics panel, so this ceiling reads directly
// against what's on screen.
const MAX_SPAWN_LOAD = 0.65;

// A room farther than this is never worth remote-mining, full stop — not every scouted room is a
// realistic candidate, and the scouting frontier (Memory.scouting.radius) grows well past this for
// unrelated reasons (general map awareness). Enforced here (not just at the scouting precompute step)
// so a source that somehow got a real path cached anyway still can't be selected past this range.
export const MAX_REMOTE_HOPS = 3;

// One scouted source flattened with the room it lives in, its computed haul distance, and the spawn
// load it would add if selected (miner + its share of transport, see mining/load.ts) — priced unreserved,
// same baseline as the economics gate below.
interface Candidate {
  room: string;
  id: Id<Source>;
  x: number;
  y: number;
  distance: number;
  loadParts: number;
  claimerShare: number; // this candidate's share of its room's amortized claimer upkeep, energy/tick
}

export const pickRemotes = wrapFn(function pickRemotes(input: PickRemotesInput): RemoteMemory[] {
  const { home } = input;

  // Gate 2 (affordability) and gate 3 (spawn capacity) are room-wide: if either fails, attempt nothing.
  if (home.energyCapacity < MIN_ENERGY_CAPACITY || home.spawnCapacity <= 0) return [];
  // Already over the load ceiling: the frequent append-only pass can only ever grow the selection, so it
  // has nothing useful to do here — bail before touching candidates at all. The rarer reevaluate pass is
  // the one mechanism that can shed load (see below), so it must NOT bail here: skipping it would freeze
  // an overloaded colony's remote fleet in place forever with no way back under the ceiling.
  if (home.spawnLoad >= MAX_SPAWN_LOAD && !input.reevaluate) return [];

  const ctx = defaultEconomyContext();

  const flat: Candidate[] = [];
  for (const cand of input.candidates) {
    if (cand.room === home.name) continue; // never our own room
    if (cand.type !== "normal") continue; // highways have no sources; keeper rooms need combat (deferred)
    if (cand.distance > MAX_REMOTE_HOPS) continue; // too far to ever be worth mining
    const info = cand.info;
    if (!info) continue; // unscouted — no source data to decide on
    for (const src of info.sources) {
      const cachedPath = src.paths?.[home.name];
      const distance =
        cachedPath !== undefined
          ? cachedPath.length
          : remoteDistanceEstimate({ roomDistance: cand.distance, source: src, storage: home.storage });
      const loadParts = remoteSourceLoadParts(home.energyCapacity, false, distance);
      // claimerShare filled in below, once each room's own worthwhile-source count is known.
      flat.push({ room: cand.room, id: src.id, x: src.x, y: src.y, distance, loadParts, claimerShare: 0 });
    }
  }

  // Gate 1 (economics): keep only sources that pay off, priced at RESERVED yield (10/tick) rather than the
  // unreserved 5/tick a source only sits at until Reservation catches up. A room with any mined source is
  // (near-)always worth reserving in practice — see remoteEconomics.ts's worthReserving and its test,
  // "+5/tick dwarfs a cheap claimer's upkeep" — so pricing at the unreserved rate would understate a room's
  // real value. Each source pays its fair share of that ONE claimer back out of the reserved yield: shared
  // across the room's own worthwhile-source count, computed per room in a first pass (a source's own net
  // decides worthwhile-or-not independent of the room's shared claimer cost — the raw per-source economics,
  // e.g. haul upkeep, don't depend on how many room-mates end up sharing the claim; only the shared cost
  // itself, divided by however many end up sharing it, does).
  const byRoomFlat = new Map<string, Candidate[]>();
  for (const c of flat) {
    const list = byRoomFlat.get(c.room);
    if (list) list.push(c);
    else byRoomFlat.set(c.room, [c]);
  }
  const worthwhile: Candidate[] = [];
  for (const roomCandidates of byRoomFlat.values()) {
    // First pass: which of this room's sources clear zero on their own merits, ignoring claim cost, to know
    // how many will actually share it. A source too far to ever pay off doesn't get to shrink its room-mates'
    // share by "participating" — only sources that already stand on their own remain in the split.
    const ownMerit = roomCandidates.filter(c => netEnergy({ distance: c.distance, reserved: true }, ctx) > 0);
    if (ownMerit.length === 0) continue;
    const claimerShare = amortizeClaimer(ctx.claimerBodyCost) / ownMerit.length;
    for (const c of ownMerit) {
      const net = netEnergy({ distance: c.distance, reserved: true }, ctx) - claimerShare;
      if (net > 0) worthwhile.push({ ...c, claimerShare });
    }
  }

  // Nearest-first, then capped: the spawn-capacity ceiling keeps the cheapest energy and can't over-commit.
  // Nearest-first is room-safe, not just source-safe: within a real room (max ~48 tiles between two
  // sources), finishing a started room by adding its farther sibling never loses to jumping straight to a
  // farther, never-before-seen room instead — the extra haul/upkeep cost of dragging along a same-room
  // sibling is always smaller than the claimer-share saved by not paying for a second room's reservation
  // (verified by sweeping every same-room distance pair up to the 48-tile bound against every possible
  // competing second-room distance — the worst-case margin across that whole sweep still favored finishing
  // the room). This only holds within one room's real bounds; it is NOT a general "always prefer more
  // sources" rule — a room farther out with a much better source can still win the cap outright (see the
  // "full re-evaluation can evict..." test), it just can't be beaten by a same-room sibling's raw distance.
  worthwhile.sort((a, b) => a.distance - b.distance);

  const alreadySelected = new Set(input.currentlySelected);
  let capped: Candidate[];
  if (input.reevaluate) {
    // Full re-rank: every worthwhile candidate (previously-selected or not) competes on equal footing,
    // re-priced with whatever distance/economics apply right now. This is the only branch that can drop
    // a previously-selected source — including shedding load on an already-over-budget colony, so it
    // must charge EVERY survivor (previously-selected or new) against the total budget, nearest-first,
    // rather than exempting incumbents the way the append-only branch below does. Otherwise a colony
    // stuck over the ceiling (e.g. from a source that's grown costlier, or the ceiling itself dropping
    // as the colony's own local roles grew) would freeze there forever with no way back under it.
    //
    // Budget nets out localLoadParts first: spending the bare ceiling on remote-source estimates alone
    // (ignoring what local roles already consume) let every candidate "fit" under cheap per-source
    // pricing even when local load alone was already near the ceiling — the real, pooled transport fleet
    // those sources actually drove then pushed total load well past 100% with nothing ever pruned.
    //
    // Room-grouped, not flat-per-source: admitting strictly nearest-first across the whole flat list would
    // greedily interleave rooms (nearest source from room A, then room B's nearest, ...) whenever their
    // sources' distances happen to interleave — e.g. two 2-source rooms at 50/70 and 51/71 would admit
    // "one from each" under a 2-source budget, paying two full claimer shares, instead of finishing the
    // nearer room (50+70, ONE shared claimer) which the sort's comment above proves is always the better
    // total within one room's real bounds. A flat sort can't see that lookahead — only grouping by room
    // and walking each room's own sources together can. Rooms are still ranked nearest-first by their own
    // nearest source (so a genuinely better room, even a single-source one, can still win the cap outright
    // — the "evict... in favor of..." test), but once a room is reached, its own sources are admitted
    // nearest-first and PARTIALLY if the room's own remaining sources don't all fit (the "prunes...
    // farthest first" test): only the sources that fit are taken, then the next room is tried with
    // whatever budget remains, rather than skipping the room's affordable members entirely.
    let loadBudget = Math.max(0, MAX_SPAWN_LOAD * home.spawnCapacity - home.localLoadParts);
    capped = [];
    const roomsInOrder: string[] = [];
    const byRoomWorthwhile = new Map<string, Candidate[]>();
    for (const c of worthwhile) {
      let list = byRoomWorthwhile.get(c.room);
      if (!list) {
        list = [];
        byRoomWorthwhile.set(c.room, list);
        roomsInOrder.push(c.room); // worthwhile is sorted nearest-first, so first-seen == nearest source
      }
      list.push(c); // already nearest-first within the room, inherited from the flat sort above
    }
    outer: for (const room of roomsInOrder) {
      for (const c of byRoomWorthwhile.get(room)!) {
        if (capped.length >= MAX_REMOTE_SOURCES) break outer;
        // `continue` (not `break`) so a room's later members still get a chance — but this can never let a
        // farther source jump ahead of a nearer one it just skipped: load/.ts's transport headcount only
        // grows or saturates with distance, so loadParts is monotonic non-decreasing within a room. If the
        // nearer member didn't fit, no farther same-room member can either; in practice this behaves exactly
        // like "stop at the room's first non-fitting member" (farthest-first pruning), just without relying
        // on that monotonicity as an unstated assumption.
        if (c.loadParts > loadBudget) continue;
        capped.push(c);
        loadBudget -= c.loadParts;
      }
    }
  } else {
    // Never drop a source we've already committed to, even if it'd fall outside the cap on a re-rank (e.g.
    // nearer candidates appeared) — pruning an over-budget colony back down is reevaluate's job (above),
    // not this frequent pass's. Then commit previously-unseen rooms whole: find the single nearest
    // never-selected room (by its nearest source) and add every worthwhile source in it together, rather
    // than trickling in one source per call while its room-mates — already paid for by the same scouting/
    // reservation cost — wait their turn behind a farther room. The whole room's load must fit the
    // remaining budget together (a partially-affordable room isn't split), since entering a room is a
    // one-time cost paid regardless of how many of its sources end up mined. Already-selected sources
    // don't spend this budget — their load is already reflected in home.spawnLoad (they're already
    // spawning live creeps/requests) — only a fresh addition should be charged.
    const kept = worthwhile.filter(c => alreadySelected.has(c.id));
    const fresh = worthwhile.filter(c => !alreadySelected.has(c.id));
    const loadBudget = Math.max(0, MAX_SPAWN_LOAD - home.spawnLoad) * home.spawnCapacity;

    capped = kept.slice(0, MAX_REMOTE_SOURCES);
    const nextRoom = fresh[0]?.room; // worthwhile is sorted nearest-first; fresh preserves that order
    if (nextRoom !== undefined && capped.length < MAX_REMOTE_SOURCES) {
      const roomSources = fresh.filter(c => c.room === nextRoom);
      const roomLoad = roomSources.reduce((sum, c) => sum + c.loadParts, 0);
      if (roomLoad <= loadBudget) {
        for (const c of roomSources) {
          if (capped.length >= MAX_REMOTE_SOURCES) break;
          capped.push(c);
        }
      }
    }
  }

  // Group surviving sources back into per-room RemoteMemory entries.
  const byRoom = new Map<string, RemoteMemory>();
  for (const c of capped) {
    let entry = byRoom.get(c.room);
    if (!entry) {
      entry = { room: c.room, sources: [], reserved: false };
      byRoom.set(c.room, entry);
    }
    entry.sources.push({ id: c.id, x: c.x, y: c.y, distance: c.distance });
  }
  return [...byRoom.values()];
}, "planning:pickRemotes");
