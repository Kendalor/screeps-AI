# In-game console commands

Every command below is installed onto `global` by `installConsoleCommands()`
(`src/commands/console.ts`), so it's callable directly from the Screeps console —
either pasted into the game client's console tab, or sent remotely via
`main-console.mjs`/pserver's equivalent (see `docs/watching-a-run.md` and the
`debug-main`/`debug-local` skills). `help()` always lists the live set with its
one-line descriptions; this doc adds the fuller context each command's output
needs to actually be useful.

## Quick reference

| command | what it does |
| --- | --- |
| `setLogLevel(level)` | set the log level (`"error"`, `"warn"`, or `"info"`) |
| `setDebugMetrics(on)` | toggle the right-aligned debug panel (remote repair + remote source status) |
| `debugCreep(name)` | trace one creep's per-tick task/step decisions |
| `undebugCreep(name)` | stop tracing a creep enabled via `debugCreep` |
| `debugColony(room)` | trace one colony's per-tick spawn requests |
| `undebugColony(room)` | stop tracing a colony enabled via `debugColony` |
| `clearDebug()` | clear every creep/colony currently opted into debug tracing |
| `resetDebug()` | reset every debug setting at once back to quiet defaults |
| `spawnLoad(room?)` | true spawn load: living + outstanding-request parts / capacity |
| `buildPlan(room)` | every planned structure for a colony, in real placement order, tagged built/sited/would-place/blocked |
| `remoteStatus(room)` | dump `colony.remoteSources` exactly as `building()`/`mining()` see it this tick |
| `miningClaims(room)` | call `Mining.structures()` directly, bypassing the operation-list plumbing |
| `operationKinds()` | list every operation kind that can request a creep spawn |
| `colonizeTargets()` | list every cached colonize candidate, sorted by score |
| `scanMarket()` | refresh `Memory.market` from `Game.market.getHistory()` now, instead of waiting for the tier-3 interval |
| `manufactureCost(resource, includeDecompress?)` | recursively price a mineral compound or commodity from `REACTIONS`/`COMMODITIES`, market vs. recipe at every level (decompress recipes off by default) |
| `clearDrainTarget(room)` | manually stop a colony's active drain |
| `removeOperation(kind, room, target?)` | stop a memory-triggered operation (colonize/attack/defend/drain/parade) |
| `help()` | list every command currently registered, with its one-line description |

## Debug tracing

**`setLogLevel(level)`** — gates `log.info`/`log.warn`/`log.error` output globally.
Most tracing below is emitted at `"info"` via `log.debugRoom`/`log.debugCreep`, so
those calls are silent unless the log level is at least `"info"`.

**`debugCreep(name)` / `undebugCreep(name)`** — adds/removes a creep name from
`Memory.debugCreeps`. While listed, every `log.debugCreep(name, ...)` call in the
behavior tree (task/step decisions — see `src/behaviors/`) prints each tick. A
creep that dies drops off the list naturally (nothing re-adds a dead name), but
it's still worth `undebugCreep`-ing intentionally once you're done, since a
respawned creep can reuse the same generated name pattern.

**`debugColony(room)` / `undebugColony(room)`** — same idea, but for a colony's
per-tick spawn/operation decisions (`log.debugRoom`). This is what
`Colony.requests()` uses to print the `requests: role(pN), ...` line every tick,
and what several operations (`Mining`, `Reservation`, `Scouting`, ...) use for
their own skip/decision traces (e.g. `mining skip remote <room>: danger` or
`reservation skip <room>: not worth reserving`). This is usually the first thing
to enable when a colony seems stuck — it shows exactly what's being requested (or
silently *not* requested) every tick.

**`clearDebug()`** — clears `Memory.debugCreeps`/`Memory.debugColonies` only,
leaving `logLevel`/`debugMetrics` alone.

**`resetDebug()`** — the "undo everything" command: `logLevel` back to `"error"`,
`debugMetrics` off, both debug lists cleared. Prefer this over separately calling
`clearDebug()`/`setLogLevel("error")`/`setDebugMetrics(false)` when wrapping up a
debug session — one call, nothing left lit up by accident. Tracing costs a small
amount of CPU/console-channel noise every tick it's live, so don't leave it running
indefinitely on a real colony.

## Spawn & construction inspection

**`spawnLoad(room?)`** — the same load figure the on-screen metrics panel shows
(`living + outstanding-request parts, divided by spawn capacity`), computed
independently so it can be queried without the panel enabled. Omit `room` to list
every owned colony at once.

**`buildPlan(room)`** — the construction arbiter's *actual* plan for a colony:
every claimed structure (bunker layout + every operation's `structures()` claims,
home and remote) in the exact order `placeAndDemolish` would place them, gated the
same way it gates them — `gateSourceGroups`' "finish one source group before
starting the next" throttle, the home/remote site-count budgets, and the
container-site cap. Each line is tagged:

- `built` — a live structure already stands there (or, for a remote route road, its
  `routeBuilt` bit already confirms it — see `RemoteSourceMemory.routeBuilt`'s doc
  in `src/memory/schema.ts`).
- `site already placed` — a construction site exists but nothing's built yet.
- `WOULD PLACE this tick` — this is what a real tick's `placeSite` intent would
  target next, budget and all.
- `queued (...)` — blocked only by a budget (home/remote site cap, or the
  one-container-site-at-a-time cap), not by anything wrong with the tile itself.
- `blocked (<room> unsafe: ...)` — the target remote room currently has danger or a
  foreign reservation (see `unsafeRemoteRooms`); no site will be attempted there
  until that clears.

This is the right first call whenever "structures aren't appearing" — it answers
whether the arbiter is even trying to place something there, and if not, exactly
which gate is holding it back. (It was written specifically to diagnose a real
incident: remote-room construction silently stalled forever behind a single
unbuildable local-source road tile — see the fix in `Mining.structures()`'s
exit-tile filtering, `src/operations/mining.ts`.)

**`remoteStatus(room)`** — a raw dump of `colony.remoteSources`, i.e. exactly what
`Mining`/`Reservation`/`Logistics` see this tick for every selected remote source:
distance, live `reserved`/`reservedBy`/`danger`, `openTiles`, cached route length,
and the `routeBuilt` bitstring. Useful for telling apart "this room was never
selected as a remote" (empty list) from "it's selected but flagged unsafe"
(`danger`/`reservedBy` set) from "it's selected and safe, but nothing's building
there" (routes present, `buildPlan` still shows nothing for that room — see
`miningClaims` next).

**`miningClaims(room)`** — calls `Mining.structures()` directly, with an empty
`planned` array, bypassing `claimsOf`'s real operation list entirely. Compare its
`local`/`remote` counts against `buildPlan`'s output: if `miningClaims` reports
plenty of remote claims but `buildPlan` shows none of them, the bug is in
`gateSourceGroups`/`placeAndDemolish`'s gating, not in `Mining` itself producing
too few claims. This is how the exit-tile bug above was actually isolated — the
raw claim count was correct, but the throttle was silently swallowing every remote
claim behind one incomplete local group.

## Operations & targeting

**`operationKinds()`** — lists every `Operation` subclass that can request a
spawn, and the one-line `trigger` describing what attaches it to a colony (always
on, a memory flag, a flag name, etc — see `SPAWNABLE_OPERATIONS` in
`src/operations/index.ts`).

**`colonizeTargets()`** — every room the empire-wide colonize picker currently
considers a candidate, with its score, distance, and whether auto-pick would
actually choose it (`REASON_LABEL` explains a non-viable candidate: already a
remote, too close/far, or unreachable).

**`clearDrainTarget(room)`** — clears `ColonyMemory.draining`, same effect as
removing the drain flag. The `Drain` operation detaches starting the next tick.

**`removeOperation(kind, room, target?)`** — the general-purpose version of the
above, covering every memory-triggered (as opposed to always-on) operation:

| kind | needs `target`? | effect |
| --- | --- | --- |
| `colonize` | yes | removes one room from `ColonyMemory.colonizing` |
| `attack` | yes | removes one room from `ColonyMemory.attacking` |
| `defend` | yes | removes one room from `ColonyMemory.defending` |
| `drain` | no | clears `ColonyMemory.draining` (same as `clearDrainTarget`) |
| `parade` | no | clears `ColonyMemory.parading` |

## Market & manufacturing

**`scanMarket()`** — forces `src/empire/market.ts`'s `scanMarketNow()` to run
immediately, refreshing `Memory.market.prices` from `Game.market.getHistory()`
(each resource's latest day with valid `avgPrice`/`stddevPrice`). The tier-3
`SYSTEMS` entry (`MARKET_SCAN_INTERVAL`, currently 20000 ticks) does this
automatically, but a stale or empty `Memory.market` — e.g. right after a reset —
means `manufactureCost` has nothing to compare recipe costs against, so this is
usually the first call to make before using it.

**`manufactureCost(resource, includeDecompress?)`** — recursively prices a
mineral compound or commodity (e.g. `"XGH2O"`, `"utrium_bar"`, `"device"`), from
`manufacturingCost()` in `src/empire/market.ts`. At every level of the recipe
tree it picks whichever is cheaper: the resource's own cached `Memory.market`
price, or the summed cost of its recipe inputs (each priced the same way,
recursively). Both `cost` and `time` are always **per unit**, not per batch —
both underlying engine recipes actually run in batches, and the raw constants
are batch totals, not per-unit figures:

- `REACTIONS` (lab reactions) — one `Lab.runReaction()` call always consumes
  `LAB_REACTION_AMOUNT` (5) of each input and produces 5 of the product, so cost
  per unit is unaffected (still a 1:1 input:output ratio), but
  `REACTION_TIME[product]` is the cooldown for that whole 5-unit batch — time per
  unit is `REACTION_TIME[product] / LAB_REACTION_AMOUNT`, not the raw constant.
- `COMMODITIES` (factory recipes) — one `Factory.produce()` call consumes the
  full listed `components` amounts and yields the recipe's `amount` (often 20,
  50, 100, or more — e.g. a batch of `utrium_bar` is 100 units per call) on one
  `cooldown`. Cost per unit is `sum(component cost * component qty) / amount`;
  time per unit is `cooldown / amount`.

Output is an indented tree: each line shows the resource, its resolved
(per-unit) cost, which method won (`market`/`reaction`/`commodity`/`unpriced`),
the raw market price if any, the raw (per-unit) recipe cost if any, and
(per-unit) time; child lines below it show the same for each component that was
actually priced (not just listed) to get there.

Raw minerals (`U`, `L`, `Z`, `K`, `G`, `O`, `H`, `X`) and `energy` each have their
own `COMMODITIES` entry too — a reverse "decompress" recipe back from their
compressed bar/battery form (e.g. `oxidant -> O`, `battery -> energy`), a real
factory recipe from the Screeps engine's own constants, not something this repo
invented. `manufactureCost` **ignores these by default** (`includeDecompress`
defaults to `false`) and treats raw minerals/energy as market-only/mined — a
factory capable of decompressing isn't always available, and the decompress
recipe is rarely the actually-intended answer for "what does this mineral cost".
Pass `true` as the second argument to let the recursion use decompress recipes
too, e.g. `manufactureCost("U", true)`.

With `includeDecompress` on, pricing a raw mineral can walk into a real cycle
(`O` needs `oxidant`, `oxidant` needs `O`, back and forth). `manufacturingCost`
guards this with a "seen" set: a resource already on the current recursion path
can only be priced from the market from that point on, so a cycle with no market
price anywhere in it correctly resolves to `unpriced`/`Infinity` rather than
recursing forever.

Without `scanMarket()` having been run recently, every resource with no cached
price falls through to whatever its recipe resolves to (or `unpriced` if that
recipe also bottoms out) — the tree is still useful for seeing recipe *shape* and
relative ticks, just not real credit costs.

## Adding a new command

Follow the existing pattern in `src/commands/console.ts`: declare the function
signature in the `declare global { ... }` block, assign `global.yourCommand = ...`
inside `installConsoleCommands()`, and call `register("yourCommand(args)",
"one-line description")` right after — that's the only thing `help()` reads, so a
command that skips `register` is invisible to `help()` even though it still works.
Prefer building on the real snapshot/operation pipeline (`empire(buildEmpireSnapshot())`,
`colony.operations`, the exported helpers in `src/colony/building.ts`) over
reimplementing gating logic by hand, so the command can't silently drift from what
a real tick actually does.
