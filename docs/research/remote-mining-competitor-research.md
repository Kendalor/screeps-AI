# How five open-source Screeps bots handle remote mining

## Status: research only (2026-08-30)

Comparative code research, companion to [`remote-mining-plan.md`](../remote-mining-plan.md) and
[`remote-mining-handoff.md`](../remote-mining-handoff.md), which document this bot's own design. This doc surveys
five well-known open-source bots plus this repo, focused on four questions: how remote rooms/sources get
selected, how roads/containers get built, whether selection is only additive or also prunes, and which
metrics actually drive the decisions.

**Bots covered** (by GitHub stars, general-purpose bots only — tooling/starter templates excluded):
`TooAngel/screeps` (645★) · `bencbartlett/Overmind` (617★) · `HoPGoldy/my-screeps-ai` (182★) ·
`ScreepsQuorum/screeps-quorum` (163★) · `The-International-Screeps-Bot/The-International-Open-Source` (123★)

A published, browsable version of this doc (with a styled comparison table) also exists as a Claude artifact;
this file is the source-of-truth text version for the repo.

**Headline finding:** the five bots split roughly into two families. **TooAngel** and **ScreepsQuorum** run
genuine automatic scoring pipelines with hard economic/CPU gates and real (if differently designed) pruning.
**Overmind** and **The International** have automatic *mechanisms* that turned out to be either scoped to
whole-room colonization rather than remote mining (Overmind) or partially unimplemented/dead-stub (The
International's road placement, cost-based ranking). **HoPGoldy/my-screeps-ai** is entirely manual —
flag-and-console-driven, with zero programmatic selection logic. This repo's own `pickRemotes` sits closest
to Quorum's design philosophy (weighted economics + hard caps + hysteresis-gated pruning) but is the only one
of the six with a documented, tested strike-counter eviction state machine.

---

## Six-bot fast comparison

| Bot | 1. Selection mechanism | 2. Road/container trigger | 3. Cap & pruning | 4. Core metrics |
|---|---|---|---|---|
| **This repo** | Pure `pickRemotes` fn: nearest-first, room-grouped, two modes (append-only every 1000t / full reevaluate every 5000t) | Claims recorded on selection; road/container *sites* wait for one-group-at-a-time queue + storage/RCL4 gate (swamp tiles exempt) | Cap 6 sources; **yes, prunes** — reevaluate-only, 3-strike hysteresis before eviction | Real PathFinder distance, per-source net-energy economics, spawn-load fraction (0.65 ceiling), sibling-colony dedup |
| **TooAngel** | `(sources/distance)*spawns >= 1` threshold formula, per candidate base room | Sourcer creep drops container + roads under its own feet while walking, opportunistic | No explicit remote-room cap; **yes, prunes** — drops reservation on low `spawnIdle` or unhealthy base (not on invasion) | Source count, linear + route distance, spawn count, `spawnIdle`, room "state" enum |
| **ScreepsQuorum** | `getMineScore`: weighted sum (sources +5, swamp -1, distance -3), range 1→2 as mines accumulate | Miner creep places container at `getMostOpenNeighbor` the moment link/container absent; roads via general layout pipeline, RCL-gated | Cap by PRL (1/2/3 mines); **yes, prunes** — cap-driven eviction, path-loss eviction, 2000-tick add cooldown, CPU gate | Source count, swampiness, distance, CPU budget (≤1.25 avg), economy level, 2000-tick add cooldown |
| **Overmind** | **Manual** flag placement (`DirectiveOutpost`) for remote-mining outposts; automatic `ExpansionEvaluator` scoring exists but targets whole-room colonization, not remote outposts | Container auto-placed by `MiningOverlord` once no site/link exists; link replaces container past 10-path-length; RCL-gated drop-mining exception | Cap = `remoteSourcesByLevel[RCL]` (1–9 sources); **eviction only on room becoming enemy-owned** — no inefficiency-based pruning found | (For expansion scoring, not remote selection) energy/distance ratio, room type, mineral bonus, distance-from-other-colonies |
| **The International** | Greedy first-scouted-wins: any room within 5 rooms / 250-tile per-source path and not keeper/enemy/ally is auto-annexed; nearer commune can "steal" a remote by lower total path cost | Container built by harvester creep on demand (source-fullness gated); **road placement appears unimplemented** — quota-tracking exists but no site-placement call found | No cap on remote count; **yes, prunes** — continuous re-evaluation, timed invasion-triggered abandonment, cascading abandonment through blocked shared paths | Path length ("efficacy"), room-type infinity-weighting, reservation cost vs. income, road-coverage quota |
| **HoPGoldy/my-screeps-ai** | **Fully manual** — player places `source0`/`source1` flags, runs `radd()` console command; zero scoring code | Opportunistic: creep builds whatever construction site already exists; bot never places remote sites itself | Hard cap of 2 sources/room (naming convention only); no cap on room count; **no automatic pruning** — `rremove()` is manual only | None used for selection; post-hoc operational signals only (damage taken, invader-core timer, reservation ticksToEnd) |

---

## 1. Remote source / room selection — how and why

### This repo

Selection is a pure function, `pickRemotes` (`src/mining/pickRemotes.ts:113-358`), fed by a `PickRemotesInput`
bundling scouted candidates, home spawn-load state, currently-selected sources, sibling-colony exclusions, and
per-source eviction "strikes." Candidate rooms come from BFS scouting (`scoutCandidatesAround`,
`src/snapshot/scoutGraph.ts:42-91`) which records real room-graph hop distance, not a linear/Chebyshev guess.
Real PathFinder distances are precomputed proactively for every scouted source within 3 hops
(`Scouting.pathPrecompute`) so ranking uses ground truth wherever available, falling back to a cheap tile-inset
estimate (`remoteDistanceEstimate`) only when no cached path exists yet.

Four short-circuit gates run before any ranking: a debug kill switch, an energy-capacity floor (550, "RCL2
with all extensions"), a spawn-capacity floor, and a load-ceiling gate (0.65 of spawn-part budget) that only
the reevaluate pass may exceed. Per-source candidates are then filtered (home room, non-normal room types,
&gt;3 hops, unscouted, hostile-owned/reserved, sibling-claimed) and priced through an economics gate
(`remoteEconomics.ts`) using the *reserved* harvest rate (10/tick) minus miner/haul/road upkeep and an
amortized claimer-cost share, split only among sources that already clear zero on their own.

The distinctive design choice is **two selection modes on different cadences**: an append-only pass (every
1000 ticks) that can only ever add — at most one never-before-selected room's whole source set per call — and
a full reevaluate pass (every 5000 ticks, or forced immediately if a selected room becomes enemy-owned) that
re-ranks everything against a shared budget and is the *only* mechanism that can evict.

### TooAngel

TooAngel frames remote mining as **reservation**, distinct from full claiming. `externalHandleRoom`
dispatches per room-controller state (`Occupied`/`Reserved`/`HostileReserved`/unclaimed). For an unclaimed
room, `spawnCreepsForReservation` iterates the bot's own rooms nearest-first and reserves from the first base
passing `getReserveRoomDistanceThreshold`: `(sourceCount / distance) * spawnCount >= 1` — explicitly documented
in-code as "1 source, distance 1, 1 spawn = fine; 1 source, distance 2, 1 spawn = not fine; 2 sources, distance
2, 1 spawn = fine." A second gate repeats the formula using real route length instead of linear distance, and
only considers routes that stay within the bot's own or already-reserved rooms. Room intel comes from passive
vision via a wandering scout role, not a dedicated scoring scan — TooAngel could not locate the exact
tick-handler that writes `room.data.state`/`sources` (a documented gap in that agent's research, likely in a
file outside the ones fetched).

### ScreepsQuorum

Quorum runs the most explicitly *scored* system of the five. `Room.prototype.getMineScore` (weights: sources
+5, walkability 0/disabled, swampiness -1, distance -3 over a 1–2 room range) ranks candidates drawn from
`Room.getRoomsInRange`, after hard-excluding Source Keeper rooms, unreachable rooms (`findRoute` with
`avoidHostileRooms`), rooms beyond the 2-room cap, unscouted rooms, owned/reserved rooms, and rooms already
claimed as a mine by a sibling city. The *first* mine for a colony must be adjacent (range 1); the search
radius only opens to range 2 once one mine already exists. A separate, much larger `getCityScore` (40-point
weighted model covering minerals, defensibility, room type, empire clustering/defense, region density) governs
*claiming* new owned rooms, not remote mining — but its `Room.getCities()` output feeds mine-owner exclusion.

### Overmind

**Manual for the thing actually being compared.** `DirectiveOutpost` — the flag type that designates a remote
mining outpost — is placed by hand (a purple/purple flag parsed by `initializer.ts`) and contains no scoring,
threat evaluation, or automatic candidate search; its only autonomous behavior is self-removing if the room
becomes enemy-owned. A genuinely automatic scoring pipeline does exist and runs by default
(`ExpansionPlanner`/`ExpansionEvaluator`, every 1000 ticks under `Autonomy.Automatic`), but its output is a
*new colony to claim* (`DirectiveColonize`), not a remote-mining assignment — confirmed by the bot author's own
blog post explicitly listing "automated room/expansion claiming" as unfinished work requiring "more extensive
scouting code." SK-room mining is a further opt-in flag type (`DirectiveSKOutpost`, RCL≥7 gate) — also manual.

### The International

Greedy, no comparison against alternatives: any scouted room within 5 rooms (linear distance, re-checked with
pathing weights that make keeper/enemy/ally rooms effectively infinite cost) and with every source/controller
path under 250 tiles is **unconditionally accepted** the moment a Scout creep visits it
(`Room.prototype.scoutMyRemote`). There is no scoring comparison between multiple candidates — the only
competitive element is that a *nearer* commune can steal an already-claimed remote from a farther one if its
total path cost is lower. A large commented-out block shows an abandoned design for a real
`sourceEfficacy` score (swamp-weighted path cost, reservation efficacy) that was never wired in — dead code.

### HoPGoldy/my-screeps-ai

No selection logic exists at all. The player scouts by hand, places a flag named `"{room} source0"` (and
optionally `source1`) on the source, and runs `W1N1.radd('W1N2', targetId)` in the console. `addRemote` only
validates that the flag exists and the delivery target is a real structure — it reads no distance, threat,
source-count, or RCL signal whatsoever. This is a useful "manual floor" datapoint against which the other
five bots' automation can be measured.

---

## 2. Road and container construction

### This repo

Two path algorithms at two stages: a cheap tile-inset estimate for ranking unscored candidates, and a real
`PathFinder.search` (`findRemotePath`, cached forever per home↔source pair, with a 20,000-tick negative cache
for permanently-unreachable sources after that cache measurably cut CPU on a live colony). A second source in
the same remote room is biased onto the first source's already-resolved route so multiple sources converge on
one shared road corridor rather than parallel roads.

Road/container tiles are **claimed** (memory-only) the instant a source is selected — this is deliberately
decoupled from actual site placement, which is gated by a shared arbiter (`src/construction/planner.ts`)
running every 100 ticks: claims are grouped by source, and **only the first not-yet-fully-built group is
allowed through** — a colony finishes one source's container+road before starting the next. Plain/wall-tile
roads (home or remote alike) wait for the colony to have a real storage (RCL4+); swamp tiles are placed
immediately regardless, since an unpaved swamp costs 5× fatigue forever. Danger in a remote room blocks *new*
site placement but does not retract already-claimed road tiles — losing vision for one tick doesn't tear down
a built road, a fix noted explicitly in-comment as a past bug.

### TooAngel

No dedicated planner file. A `sourcer` creep with `buildRoad: true` drops a road construction site under its
own tile as it walks its cached route (capped globally at 80 sites, 3 per room), and separately builds/repairs
a container at its own mining position the moment none exists — both fully opportunistic and creep-driven,
with no room-wide layout computed in advance. `reserver` creeps do not pave roads.

### ScreepsQuorum

The container claim/placement is triggered directly from the mining process (`mine.js`): if no link and no
container/site exists at the miner's `getMostOpenNeighbor` stand tile, a container site is placed that tick,
with no RCL gate beyond the mine itself existing; a link supersedes and destroys the container once built.
Roads are **not** placed by the mining code — they ride on the general layout/construction pipeline, gated by
a `SKIP_STRUCTURE_ROAD` room-setting that's true before RCL4 and cleared after, meaning remote roads generally
don't appear before RCL4, similar in spirit to this repo's storage/RCL4 gate.

### Overmind

Container placement is reactive per-source inside `MiningOverlord`: if no container, construction site, or
link exists, one is placed; below a configurable RCL threshold, drop-mining is used instead of a container at
all. Once a link exists within range, the container is torn down (with a safety check that it isn't still
needed near the hatchery/upgrade site). A separate `RoadPlanner`, instantiated from the room planner,
recalculates the whole road network every 1000 ticks with a merging heuristic and lets deprecated roads decay
naturally rather than actively demolishing them — a different philosophy from this repo's group-gated,
one-source-at-a-time queue.

### The International

Real per-source and per-controller paths are precomputed and cached the moment a room becomes a remote
(`findRemoteSourceHarvestPositions`, `findRemoteSourceFastFillerPaths`, etc.), with paths deliberately drawn
through already-planned structure locations so hauler routes converge onto shared corridors — conceptually
close to this repo's route-biasing trick. Containers are placed by the harvesting creep itself, gated on the
room actually being reserved by the bot and on the source being nearly full relative to its regen cycle (an
economic timing gate not seen in the other bots). **Road placement, however, appears to be unimplemented**:
the data plumbing for tracking road coverage against a quota exists and is consulted by haulers deciding
whether to accept an assignment, but no code path was found that actually calls `createConstructionSite` for
a remote road — an empty `remoteActions?() {}` stub in `RemoteBuilder` and dead `remoteProcs`/`remoteUtils`
classes corroborate this being WIP rather than a design choice.

### HoPGoldy/my-screeps-ai

No siting or triggering logic at all. A `remoteHarvester` only checks whether any construction sites already
exist in the room on its first "prepare" tick; if none, it flags itself to never build for its whole lifetime.
Containers get registered generically once built, and roads only get repaired in-passing if the creep happens
to be standing on a damaged one — there is no code path that ever calls `createConstructionSite` for a remote
road or container. Whatever infrastructure exists there was placed by the player.

---

## 3. How many sources are selected, and is there pruning?

| Bot | Cap mechanism | Additive-only or prunes? | Eviction trigger |
|---|---|---|---|
| **This repo** | `MAX_REMOTE_SOURCES = 6` hard cap; `MAX_SPAWN_LOAD = 0.65` soft ceiling; `MAX_REMOTE_HOPS = 3` | **Prunes**, but only on the 5000-tick reevaluate pass | Fails the room-budget cut for 3 consecutive reevaluate passes (hysteresis); hard cap always wins over hysteresis, bumping newest admissions first; immediate forced reevaluate if a selected room becomes enemy-owned |
| **TooAngel** | No explicit remote-room cap; self-limits via the distance/spawn-count threshold and `spawnIdle` | **Prunes** | `spawnIdle < 0.2` (base over-utilized) or base `isHealthy()` fails; invasion is handled by fighting to retake the reservation, not by abandoning it |
| **ScreepsQuorum** | `REMOTE_MINES` by PRL (1/2/3); 2000-tick empire-wide add cooldown; CPU gate (≤1.25 avg) | **Prunes** | Cap exceeded after a PRL/setting downgrade evicts highest-indexed mines; route becomes unreachable (`ERR_NO_PATH`); invasion suppresses spawning (`underAttack`) without deleting the assignment outright |
| **Overmind** | `remoteSourcesByLevel[RCL]` (1–9 sources) | **Barely prunes** | Only confirmed automatic removal: outpost directive self-removes if the room becomes owned by another player; no inefficiency-based pruning found in the files researched |
| **The International** | No cap on remote count; sources ranked (not capped) by cached-path "efficacy" | **Prunes continuously** | Room-type/commune mismatch; enemy attackers trigger a timed `abandonRemote` counter (not permanent); abandonment cascades to sibling remotes whose cached paths route through the now-dangerous room; individual sources can be disabled without dropping the whole remote |
| **HoPGoldy/my-screeps-ai** | Hard cap of 2 sources/room (flag-naming convention); no cap on room count | **Additive only** | None automatic — `rremove()` is a manual console command; a `disableTill` counter pauses (not evicts) a remote during invasion |

The three bots with genuine automatic pruning (this repo, TooAngel, Quorum, The International — four,
correcting the table framing above) each pick a different trigger philosophy: **this repo** uses a
sunk-cost-aware strike counter so a squeezed-but-not-worthless incumbent survives short-term budget pressure;
**TooAngel** prunes on the *sponsor's* health (spawn idle time), not the remote's own conditions; **Quorum**
treats invasion as a spawning pause rather than a deletion, only removing on structural change (cap shrink,
path loss); **The International** is the most reactive, with a timed abandon-and-cascade mechanic that
actively models shared-route contamination between sibling remotes.

---

## 4. What metrics drive the decision

| Metric | This repo | TooAngel | Quorum | Overmind | The International | HoPGoldy |
|---|---|---|---|---|---|---|
| Distance (hop/linear) | ✅ real BFS hop count | ✅ linear + route | ✅ room-range (1→2) | ✅ path length (expansion only) | ✅ linear (max 5) | ❌ |
| Real pathed distance | ✅ cached PathFinder | ✅ route-based gate | — (not confirmed) | ✅ (expansion scoring) | ✅ cached per-source | ❌ |
| Source count | Indirect (via economics) | ✅ core of threshold formula | ✅ +5 weight | ✅ cap table only | ❌ (not scored) | ❌ (cap by convention only) |
| Threat/hostile presence | ✅ hard exclude + live danger decay | Reactive (fight, don't evict) | ✅ hard exclude + `underAttack` pause | ✅ invasion-likelihood heuristic | ✅ infinite path-weight + timed abandon | Reactive pause only |
| Reservation status | ✅ sets harvest rate 5→10/tick | ✅ room-state enum | ✅ (via mine ownership) | — | ✅ doubles income cap | Read, not scored |
| Spawn/CPU budget | ✅ 0.65 load ceiling | ✅ `spawnIdle` gate | ✅ CPU ≤1.25 gate | — | — | ❌ |
| Net-energy/ROI economics | ✅ explicit `netEnergy` formula | — | — (city score has mineral-market pricing, not mine) | ✅ energy/distance ratio (expansion only) | ✅ income-minus-upkeep credit | ❌ |
| RCL gate | Indirect (energy capacity, not RCL) | — | ✅ PRL-tied cap | ✅ cap table + SK gate | Indirect (via base-plan anchor) | ❌ |
| Sibling/empire dedup | ✅ excluded source IDs | — | ✅ mine-owner exclusion | — | ✅ "steal by lower cost" | ❌ |
| Rate limiting | ✅ 1 room/1000t add, 5000t reevaluate | ✅ 1499-tick recheck interval | ✅ 2000-tick add cooldown | ✅ 1000-tick expansion check | — | ❌ |
| Eviction hysteresis | ✅ 3-strike counter | ❌ (single-condition) | ❌ (single-condition) | ❌ | Partial (timed abandon counter) | ❌ |

**Notable absence across every bot except this repo**: none of the five external bots implement a documented
multi-tick hysteresis counter for remote eviction — most either evict on the first failing condition (Quorum,
TooAngel) or use a fixed timed pause (The International's `abandonRemote`, Quorum's `underAttack` suppression)
rather than a strike-accumulation model. This repo's "adding a remote is a sunk-cost bet — the bar to walk
away should sit higher than the bar to take one on" framing (`pickRemotes.ts` comment) appears to be a
deliberate design point not otherwise represented in the surveyed field.

**Notable strength elsewhere**: The International's route-contamination cascade (abandoning remote B because
its cached path physically crosses newly-dangerous remote A) models a real failure mode — a shared hauler
corridor going through hostile territory — that this repo's per-source-only danger model does not currently
address, since each remote room's danger is tracked independently rather than propagated along shared route
segments.

---

## Sources

- This repo: `src/mining/pickRemotes.ts`, `src/mining/load.ts`, `src/mining/distance.ts`,
  `src/mining/remoteEconomics.ts`, `src/mining/remoteSources.ts`, `src/snapshot/scoutGraph.ts`,
  `src/operations/mining.ts`, `src/operations/scouting.ts`, `src/lib/remotePath.ts`,
  `src/construction/planner.ts`, `src/intents/execute.ts`; tests in `test/unit/mining/`,
  `test/unit/operations/mining.test.ts`, `test/integration/remote-mining.test.ts`.
- TooAngel: [`TooAngel/screeps`](https://github.com/TooAngel/screeps) — `src/prototype_room_external.js`,
  `src/prototype_creep.js`, `src/role_sourcer.js`, `src/role_reserver.js`, `src/brain_nextroom.js`,
  `src/prototype_room_routing.js`, `doc/Design.md`.
- ScreepsQuorum: [`ScreepsQuorum/screeps-quorum`](https://github.com/ScreepsQuorum/screeps-quorum) —
  `src/extends/room/territory.js`, `src/programs/city/mine.js`, `src/programs/city.js`,
  `src/extends/room/control.js`, `src/extends/room/economy.js`, `src/extends/room/intel.js`, `src/lib/map.js`,
  `src/constants.js`.
- Overmind: [`bencbartlett/Overmind`](https://github.com/bencbartlett/Overmind) —
  `src/directives/colony/outpost.ts`, `src/directives/colony/outpostSK.ts`, `src/directives/initializer.ts`,
  `src/strategy/ExpansionPlanner.ts`, `src/strategy/ExpansionEvaluator.ts`, `src/intel/RoomIntel.ts`,
  `src/overlords/mining/miner.ts`, `src/Colony.ts`, `src/~settings.ts`; author blog
  ("Screeps #3: State of the Automated Union").
- The International: [`The-International-Screeps-Bot/The-International-Open-Source`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source)
  (branch `Main`) — `src/room/roomFunctions.ts`, `src/room/room.ts`, `src/room/roomOps.ts`,
  `src/room/commune/remotesManager.ts`, `src/room/creeps/roleManagers/remote/remoteSourceHarvester.ts`,
  `src/room/creeps/roles/haulerOps.ts`, `src/room/creeps/roleManagers/international/scout.ts`,
  `src/room/roomNameUtils.ts`, `src/international/roomPruning.ts`, `src/constants/general.ts`.
- HoPGoldy/my-screeps-ai: [`HoPGoldy/my-screeps-ai`](https://github.com/HoPGoldy/my-screeps-ai) —
  `src/mount/room/console.ts`, `src/mount/room/extension.ts`, `src/mount/room/creepControl.ts`,
  `src/role/remote.ts`, `src/mount/creep/extension.ts`, `doc/外矿拓展.md` ("How to develop a remote mine").
