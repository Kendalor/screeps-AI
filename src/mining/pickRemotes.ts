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
import { defaultEconomyContext, netEnergy } from "./remoteEconomics";

export interface PickRemotesHome {
  name: string; // home room — never mine our own room as a remote
  storage: XY; // home storage/anchor, the haul endpoint distance is measured from
  energyCapacity: number; // affordability gate: can we spawn a useful miner/claimer body
  // Capacity gate: same colony-fraction formula as the metrics panel's spawn `load` (parts /
  // (spawns * PARTS_PER_SPAWN), see colony/metrics.ts) — comparable numbers, not a separate concept.
  spawnLoad: number; // current colony-wide fraction (0..1+) before any new remote source
  spawnCapacity: number; // parts these spawns can sustain (spawns.length * PARTS_PER_SPAWN); 0 disables selection
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
const MAX_SPAWN_LOAD = 0.85;

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
      flat.push({ room: cand.room, id: src.id, x: src.x, y: src.y, distance, loadParts });
    }
  }

  // Gate 1 (economics): keep only sources that pay off. reserved:false — selection prices the baseline
  // unreserved yield; Reservation later upgrades a room whose sources are all being mined.
  const worthwhile = flat.filter(
    c => netEnergy({ ...c, room: c.room, openTiles: 0, reserved: false, danger: 0 }, ctx) > 0
  );

  // Nearest-first, then capped: the spawn-capacity ceiling keeps the cheapest energy and can't over-commit.
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
    let loadBudget = MAX_SPAWN_LOAD * home.spawnCapacity;
    capped = [];
    for (const c of worthwhile) {
      if (capped.length >= MAX_REMOTE_SOURCES) break;
      if (c.loadParts > loadBudget) continue;
      capped.push(c);
      loadBudget -= c.loadParts;
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
