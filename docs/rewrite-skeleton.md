# Rewrite Skeleton

Design reference for the v2 AI. Derived from the July 2026 review of the old codebase:
the five pain points (repetitive behaviors, null checks, opaque scheduler, invisible state,
crude roles) are treated as hard requirements here, and the three legitimate intentions
behind the old design (flag commands, CPU-pressure degradation, testability) are kept —
with lighter mechanisms.

Ground rules carried over from the review:

1. Typed memory schemas — no `[id: string]: any`, ever.
2. Rooms as plain tiered loops with CPU checkpoints — no serialized process objects.
3. Behaviors as parameterized data — no per-structure-type class files.
4. Flags/console are input only, translated at the boundary — internal code never creates flags.
5. Pure planners returning intents; thin actuators — everything decision-shaped is unit-testable.

---

## 1. Directory layout

```
src/
  main.ts               # loop entry: memory load/migrate, kernel.tick(), stats flush
  kernel/
    tick.ts             # the tiered loop
    budget.ts           # CPU/bucket checkpoint helpers
    stats.ts            # per-system CPU accounting (port of EmpireStats idea)
  memory/
    schema.ts           # ALL memory interfaces — single source of truth
    migrate.ts          # per-section versioned migrations
    cache.ts            # RawMemory parse-skip trick (ported from MemoryUtils)
  snapshot/
    colony.ts           # build ColonySnapshot from Game state (the only place that reads Game for planners)
    census.ts           # alive/spawning/dying creep counts per role per colony
  intents/
    types.ts            # Intent union
    execute.ts          # the actuator: one switch, calls game API, logs failures
  systems/              # pure planners: (snapshot, memory) => Intent[]
    defense.ts          # towers + safemode          (tier 1)
    spawning.ts         # census diff -> spawn intents (tier 1)
    links.ts            # link network transfers      (tier 1)
    creeps.ts           # behavior interpreter dispatch (tier 1)
    mining.ts           # source assignment, container/link placement (tier 2)
    logistics.ts        # haul request matching       (tier 2)
    upgrading.ts        # upgrader quotas             (tier 2)
    building.ts         # construction sites from layout (tier 3)
    scouting.ts         # scout todo list             (tier 3)
    market.ts           # terminal sales              (tier 3)
    expansion.ts        # colonize state machine      (tier 3)
  behaviors/
    types.ts            # Step / Behavior definitions
    interpreter.ts      # runs a Behavior for one creep for one tick
    steps.ts            # step implementations (harvest, transfer, build, ...)
    targets.ts          # resolveTarget(spec) — the ONE place that searches for targets
    roles.ts            # role table: body calculator + behavior per role
  layouts/
    *.json              # ported bunker layouts (Base_1..Base_7)
    stamp.ts            # anchor placement + stamping (port of Bunker.ts)
    roads.ts            # storage->source/controller road paths (port from Miner/UpgradeOperation)
  commands/
    console.ts          # global.cmd.* — the ONLY user-facing entry points
    flags.ts            # flag color table -> cmd.* calls, then flag.remove()
  visuals/
    dashboard.ts        # RoomVisual overlay per colony + cmd.status() table
  lib/
    traveler.ts         # ported verbatim
test/
  unit/                 # vitest: planner tests with fixture snapshots
  integration/          # screeps-server-mockup milestone scenarios
```

Rule of thumb: `systems/` and `behaviors/steps.ts` never touch `Game.*` directly —
they receive snapshots and return intents. `snapshot/`, `intents/execute.ts`, and
`lib/` are the only modules allowed to talk to the live API.
(Pragmatic exception: creep *movement* — `travelTo` keeps internal path state and is
called from the interpreter directly. Purity is enforced where it pays: room-level
decisions. Don't fight the engine over pathfinding.)

---

## 2. The tiered loop (kernel/tick.ts)

Replaces: OperationsManager + the whole Operation lifecycle.

```ts
interface System {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks (replaces Operation.pause)
  run(snap: EmpireSnapshot): Intent[];
}

const SYSTEMS: System[] = [
  // tier 1 — must run, every tick, even at 0 bucket
  { name: "defense",  tier: 1, run: planDefense },
  { name: "spawning", tier: 1, run: planSpawning },
  { name: "links",    tier: 1, run: planLinks },
  { name: "creeps",   tier: 1, run: runCreepBehaviors },   // interpreter dispatch
  // tier 2 — economy planning; skip under CPU pressure
  { name: "mining",    tier: 2, interval: 20,  run: planMining },
  { name: "logistics", tier: 2, interval: 10,  run: planLogistics },
  { name: "upgrading", tier: 2, interval: 50,  run: planUpgrading },
  // tier 3 — luxury; needs bucket headroom
  { name: "building",  tier: 3, interval: 100, run: planBuilding },
  { name: "scouting",  tier: 3, interval: 100, run: planScouting },
  { name: "market",    tier: 3, interval: 500, run: planMarket },
  { name: "expansion", tier: 3, interval: 100, run: planExpansion },
  { name: "visuals",   tier: 3, run: drawDashboards },
];

export function tick(): void {
  const snap = buildEmpireSnapshot();            // one pass over Game.rooms/creeps
  for (const sys of SYSTEMS) {
    if (sys.interval && Game.time % sys.interval !== 0) continue;
    if (sys.tier >= 2 && Game.cpu.getUsed() > Game.cpu.limit * 0.6) break;
    if (sys.tier >= 3 && (Game.cpu.getUsed() > Game.cpu.limit * 0.85 || Game.cpu.bucket < 3000)) break;
    const t = Game.cpu.getUsed();
    try {
      execute(sys.run(snap));                    // plan, then act immediately
    } catch (e) {
      log.error(`${sys.name} threw: ${e instanceof Error ? e.stack : e}`);
    }
    stats.record(sys.name, Game.cpu.getUsed() - t);
  }
}
```

What this fixes vs. the old scheduler, point by point:

- CPU guard measures against `Game.cpu.limit` (steady state), not `tickLimit`
  (bucket-inflated) — degradation is gradual, not a cliff.
- Systems are ordered in *source code*, not by priority numbers nobody set.
- Tier 1 includes creep execution — the layer that actually burns CPU is inside
  the protection, unlike the old design where CreepManager ran unguarded.
- No rehydration: systems are plain functions; state they need is in typed Memory.
- try/catch per system keeps the crash isolation the old design bought with 10x machinery.
- `interval` replaces `pause` — visible in one table instead of buried per-instance.

---

## 3. Typed memory schema (memory/schema.ts)

Replaces: `data: {[id: string]: any}`, `Memory.empire`, ad-hoc `room.memory.base`.

```ts
declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
  }

  interface CreepMemory {
    home: string;                 // colony room name
    role: RoleName;
    task?: TaskState;             // current behavior progress — see behaviors/types.ts
  }

  interface RoomMemory {
    scouted?: ScoutInfo;          // written by scouting system only
  }
}

export type RoleName =
  | "bootstrap" | "miner" | "hauler" | "upgrader" | "builder"
  | "sitter" | "scout" | "claimer" | "pioneer";

export interface ColonyMemory {
  anchor?: { x: number; y: number };            // bunker anchor from layout planner
  sources: Record<Id<Source>, SourceMemory>;    // container/link ids, assigned miner count
  links?: LinkNetworkMemory;                    // storage/controller/source link ids
  remotes: string[];                            // remote mining room names (future)
  danger: number;                                // hostile-presence counter for emergency logic
}

export interface SourceMemory {
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
  spot?: { x: number; y: number };              // mining position
}

export interface LinkNetworkMemory {
  storage?: Id<StructureLink>;
  controller?: Id<StructureLink>;
  sources: Id<StructureLink>[];
}
```

Rules:

- Every field is *owned by exactly one system* (noted in comments). Others read it
  through the snapshot, never write it.
- Store `Id<T>`, resolve with `Game.getObjectById` in the snapshot builder; a null
  resolution *clears the field there*, so planners never see stale ids. This is what
  kills the null-check pyramids: invalidity is handled once, at the boundary.
- `migrate.ts` versions *sections* independently — bumping the link schema doesn't
  wipe scouting data (the old all-or-nothing `memoryVersion` wipe is gone).
- **No spawn queue in memory.** See spawning below — the queue was the old design's
  biggest bookkeeping liability and it isn't needed at all.

---

## 4. Pure planner / actuator split

### Intents (intents/types.ts)

```ts
export type Intent =
  | { kind: "towerAttack"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "towerHeal";   tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "safeMode";    room: string }
  | { kind: "spawn";       spawn: Id<StructureSpawn>; role: RoleName; body: BodyPartConstant[];
      memory: CreepMemory; dir?: DirectionConstant }
  | { kind: "linkSend";    from: Id<StructureLink>; to: Id<StructureLink> }
  | { kind: "placeSite";   room: string; x: number; y: number; type: BuildableStructureConstant }
  | { kind: "marketDeal";  order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number };
```

The actuator (`intents/execute.ts`) is one switch statement. It is the only place
that checks return codes, and it logs every non-OK result with the intent that
caused it — failed actions become visible instead of silent.

### Worked example — tower defense (the first thing to write + test)

```ts
// systems/defense.ts — pure. Direct port of old DefenseOperation logic, minus Game access.
export function planDefense(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    if (colony.hostiles.length > 0) {
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        out.push({ kind: "safeMode", room: colony.name });
        continue;
      }
      for (const tower of colony.towers) {
        const target = closest(tower.pos, colony.hostiles);   // pure geometry helper
        if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
      }
    } else {
      for (const tower of colony.towers) {
        const hurt = closest(tower.pos, colony.woundedFriendlies);
        if (hurt) out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
      }
    }
  }
  return out;
}
```

```ts
// test/unit/defense.test.ts — no server, no globals, milliseconds to run
it("prefers safemode when towerless and invaded", () => {
  const snap = fixture({ hostiles: [hostileAt(10, 10)], towers: [], safeModeAvailable: true });
  expect(planDefense(snap)).toEqual([{ kind: "safeMode", room: "W1N1" }]);
});
```

### Spawning without a queue (systems/spawning.ts)

Replaces: SpawnManager + toSpawnList + entry validation + `validateCreeps()` in every operation.

Each tick: compute **desired census** per colony (a pure function of RCL, storage
energy, source count, construction backlog — porting the old quota formulas), compare
against **actual census** (alive + currently spawning − creeps that will die within
`body.length * 3 + travelTime` ticks, which replaces the old `rebuild`/1500-tick-pause
mechanism), and emit spawn intents for the highest-priority deficit. Creep names are
deterministic (`miner_W1N1_1234567`) — no random-name collisions, no orphaned queue
entries, no cross-registry validation. The entire class of "creep list bookkeeping"
bugs from the old code (OperationMinePower's triple-pasted validateCreeps, ColonizeOp's
quadruple cleanup block) ceases to exist because there is no list to maintain.

Two requirements the old queue *did* meet, preserved without persistence:

- **Cross-spawn allocation.** Planners emit an ephemeral `SpawnRequest[]` (this tick
  only); a pure allocator matches requests to available spawns — local requests to
  their colony, expansion/remote requests to "nearest colony with ≥ X energy capacity"
  (port of `FlagListener.findnearestBaseOp`). Because matching is recomputed every
  tick, requests re-route automatically when a base is drained or besieged — the old
  queue froze the spawn-room choice at enqueue time and stalled if it went bad.
- **Spawn capacity ("is this colony full?").** Computed predictively instead of
  inferred from queue backlog: a spawn provides 1500 spawn-ticks per creep lifetime,
  a creep costs `bodyParts × 3` ticks, so
  `spawnLoad = Σ_desired(bodyParts_i × 3) / (1500 × numSpawns)`.
  If load exceeds ~0.85 the census trims lowest-priority quotas first. Shown on the
  dashboard; invariant-tested (`spawnLoad < 1`).

---

## 5. Behaviors as data (behaviors/)

Replaces: 90 job files + 19 role classes + 2 drifting registries.

```ts
// behaviors/types.ts
export type TargetSpec =
  | { find: "structure"; type: StructureConstant; where?: "notFull" | "hasEnergy" | "damaged" }
  | { find: "dropped" } | { find: "tombstone" } | { find: "source" }
  | { find: "constructionSite" } | { find: "controller" }
  | { find: "id"; id: Id<RoomObject> };

export type Step =
  | { do: "harvest";  from: TargetSpec }
  | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
  | { do: "pickup";   from: TargetSpec }
  | { do: "transfer"; to: TargetSpec;   resource?: ResourceConstant }
  | { do: "build";    at?: TargetSpec }
  | { do: "repair";   at: TargetSpec; upTo?: number }
  | { do: "upgrade" }
  | { do: "moveToRoom"; room: string }
  | { do: "sit"; pos: { x: number; y: number } };   // for the anchor logistics sitter

export interface TaskState {           // lives in creep.memory.task
  step: number;                        // index into the role's step list
  target?: Id<RoomObject>;             // locked target for the current step
}
```

The interpreter (`behaviors/interpreter.ts`) runs the creep's current step each tick:
resolve/validate target (via `targets.ts` — the *single* replacement for 60 copies of
`getTargetId`), act or `travelTo`, and advance to the next step when the step's
completion condition fires (store full/empty, target gone, arrived). Steps wrap around.
That is the whole creep framework — ~150 lines, one file to debug.

Roles become a table:

```ts
// behaviors/roles.ts
export const ROLES: Record<RoleName, RoleDef> = {
  miner: {
    body: (e) => minerBody(e),                    // ported energy-tier table from MinerOperation
    steps: [{ do: "harvest", from: { find: "source" } },
            { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
            { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }],
  },
  hauler: {
    body: (e) => scale([CARRY, CARRY, MOVE], e, 1200),
    steps: [{ do: "pickup",   from: { find: "dropped" } },
            { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
            { do: "transfer", to:   { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } }],
  },
  // upgrader, builder, bootstrap, sitter, scout, claimer, pioneer ...
};
```

Old `Supply` + `SupplyTower` + `SupplyExtension` + `SupplySpawn` + `PickupStorage` + ... 
= one hauler-like entry with different `TargetSpec`s. Adding a new behavior is adding
a row, not five files and two registry entries. Emergency overrides (the thing
Allrounder hacked into `run()`) live in the interpreter as explicit preemption checks
(e.g. controller downgrade imminent → force upgrade step), in one known place.

---

## 6. Command boundary (commands/)

Replaces: FlagListener + flag-memory side channel.

```ts
// commands/console.ts — canonical entry points; internal systems call these too
global.cmd = {
  claim: (room: string, from?: string) => expansion.requestClaim(room, from),
  colonize: (room: string) => expansion.requestColonize(room),
  status: (room?: string) => dashboard.printStatus(room),
  wipeSection: (s: keyof Memory) => migrate.reset(s),
};
```

`commands/flags.ts` parses the **flag name** — verb prefix plus optional `:`-separated
params (`claim`, `attack:5`) — not colors (2-digit protocol, no params) and not flag
memory (can't be set from the game UI; if you're typing in the console anyway, call
`cmd.*` directly). The flag's position is the spatial argument. Two command kinds:

- **One-shot** (`claim`, `nuke`): translate to a `cmd.*` call, then `flag.remove()`.
- **Standing orders** (`remote-mine`, `rally`, `defend`): the flag's *existence* is
  the order — re-read on the owning system's interval, cancelled by deleting the flag.
  Associated state lives in typed memory keyed by flag name; the flag is the on/off
  switch and position marker, never the data store.

Internal code never places flags; `expansion.ts` holds its state in `Memory.expansion`
as a typed state machine (`phase: "claiming" | "pioneering" | "handoff"`), which is
the fixed version of ColonizeOperation's cancel-counter soup.

---

## 7. Transparency from day one (visuals/)

- `dashboard.ts` draws per-colony RoomVisual: RCL progress, energy, census
  actual/desired per role, spawn deficit, spawn load, CPU per system (from
  `kernel/telemetry.ts`), active expansion phases.
- `Game.map.visual` overlay: markers on rooms with active directives (expansion
  targets, remotes, standing orders) — a "virtual flag" rendered each tick from
  typed memory. Replaces the spatial visibility of consumed flags, but derived
  from the single source of truth so it cannot desync. (Flag names cap at 60
  chars — ample for `verb:param` encoding.)
- `cmd.status(room?)` prints the same as a console table.
- The logger has levels *and a subsystem tag*; default WARNING, `cmd.debug("links")`
  flips one system to DEBUG. No more archaeology through raw console.log spam.

---

## 8. Testing

- **Unit (vitest)**: every `systems/*` planner and `behaviors/targets.ts` gets fixture
  tests. A ~50-line `test/constants.ts` stubs the Screeps constants; snapshots are
  plain objects, so no game engine is involved.
- **Integration (screeps-server-mockup)**: milestone scenarios —
  "fresh spawn reaches RCL2 < 3000 ticks", "storage online by RCL4", "colony survives
  an invader wave". Run on demand, not per-commit.

### Scenario forensics (kernel/telemetry.ts — shared with the in-game dashboard)

Telemetry has two sinks: RoomVisual/`cmd.status()` in game, JSON artifacts in the
mockup harness. Same events, same gauges — transparency and test diagnostics are
one subsystem.

1. **Checkpoint ladder**: scenarios assert sub-milestones with tick windows
   (first creep ~60, first energy-full ~200, container ~800, RCL2 ~2500), not one
   final assert. The report names the first rung missed → failure phase is known
   before reading data.
2. **Gauges**: sampled every ~10 ticks into `timeline.ndjson` — energy avail/cap,
   storage, census desired vs actual per role, spawnLoad, spawn idle, controller
   progress, construction progress, CPU per system.
3. **Events**: `events.ndjson` — every actuator non-OK result `{tick, system,
   intent, err}`, creep deaths, emergency triggers, state-machine phase transitions.
4. **Watchdog invariants** emitting named symptoms during the run: spawn idle
   while deficit > 0; creep idle > 50 ticks; energy full but no spawn intent;
   controller downgrade timer falling. They convert "scenario missed" into a
   differential diagnosis.

On failure the harness writes checkpoints.json + timeline.ndjson + events.ndjson +
final Memory dump — summary-first, structured, causally ordered. This bundle is the
data contract for feeding an agent (or a human) the "why", e.g.: checkpoint
"container by 800" missed → hauler census desired 2 / actual 0 since tick 300 →
40× spawn intent rejected ERR_NOT_ENOUGH_ENERGY → bootstrap quota undersized.

---

## 9. Porting backlog (old → new)

Ordered so each phase yields a playable bot. "Port" = copy logic, adapt to
snapshot/intent types. "Rewrite" = keep the idea, redo the code.

### P0 — boots on the ground (bot spawns, harvests, upgrades)
| Old | New | Mode |
|---|---|---|
| `src/empire/memory/MemoryUtils.ts` (parse-skip cache) | `memory/cache.ts` | port verbatim |
| `src/utils/traveler/Traveler.ts` | `lib/traveler.ts` | port verbatim |
| `SpawnManager.run` dry-run + spawn-direction logic | `intents/execute.ts` spawn case | port |
| `Allrounder.getBody` / Maintenance body math | `roles.ts` bootstrap | port |
| Harvest/Upgrade/Supply job cancel conditions | step completion rules in `interpreter.ts` | rewrite |

### P1 — stable colony to storage (RCL 1→4)
| Old | New | Mode |
|---|---|---|
| `MinerOperation.getMinerBody` energy-tier table | `roles.ts` minerBody | port |
| `UpgradeOperation.getMaxUpgraders` (storage-energy scaling) | `systems/upgrading.ts` | port |
| `BuildOperation` builder-count formula | `systems/building.ts` quota | port |
| `HaulerOperation` carry-parts-from-path-length math | `systems/logistics.ts` | port |
| `DefenseOperation` tower attack/heal + safemode | `systems/defense.ts` | port (first test target) |
| `InitRoomOperation.checkForEmergency` starvation counter | `systems/spawning.ts` emergency census | rewrite |

### P2 — base building
| Old | New | Mode |
|---|---|---|
| `layouts/Base_1..7.json` | `layouts/*.json` | copy |
| `Bunker.ts` anchor search + stamping | `layouts/stamp.ts` | port |
| `RoomPlannerUtils.ts` cost matrices | `layouts/roads.ts` | port |
| `MinerOperation.getBuildingList` roads+container/link placement | `layouts/roads.ts` | port |
| `UpgradeOperation.getBuildingList` controller road + link pos | `layouts/roads.ts` | port |

### P3 — RCL 5+ economy
| Old | New | Mode |
|---|---|---|
| `RoomLogisticsOperation` link discovery + transfer rules | `systems/links.ts` | port |
| `LogisticJob` anchor sitter | `sit` step + sitter role | rewrite (was the framework-breaker) |
| `TradingOperation` price calc (avg − stddev) + deal fallback | `systems/market.ts` | port |
| `OperationMineMinerals` extractor flow | `systems/mining.ts` | port |

### P4 — expansion & beyond
| Old | New | Mode |
|---|---|---|
| `OperationScoutingManager` radius/todo logic | `systems/scouting.ts` | port |
| `ColonizeOperation` + `ClaimOperation` + Colonize role | `systems/expansion.ts` typed state machine | rewrite (buggy source) |
| `FlagListener` color table | `commands/flags.ts` | port table only |
| `CreepManager.checkInterShardMemory` cross-shard recovery | deferred | later |
| `OperationMinePower` / `OperationMineDeposit` squads | deferred | later |
| `RemoteMiningOperation` | never implemented — design fresh in `systems/mining.ts` | new |

### Explicitly NOT ported
Operation base class & lifecycle, OperationsManager, opFactory switch, the 90 job
files, the 19 role classes, both role registries, EmpireManager's global-op
bookkeeping, the memory `pause` mechanics, random name generation.

### Known old bugs — do not carry over
- `EmpireManager.canColonize`: `getColonizeOps.length` missing `()` (broken throttle)
- `getBaseOps` cache never assigned; rebuilds + rewrites myRooms every call
- `ColonizeOperation.wrapUp` called unconditionally every tick
- 3–5 char `Math.random()` names → collision-prone (fixed by deterministic names)
- `RoomMemoryUtil.getCostMatrix` returned the CostMatrix constructor (fixed in old repo 2026-07)
