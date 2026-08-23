# Boosting plan (v2 — supersedes boosting-reactions-plan.md's M2-M4/M7)

## Status: design only (2026-08-23)
Zero code written. This is the redesigned boosting architecture that came out of a grilling session
following `docs/boosting-competitor-research.md` (comparative code research across Overmind, Hivemind,
The International, TooAngel, KasamiBot, HoPGoldy). Goal order for this codebase is **Empire logistics →
Market logic → Creep Boosting → Reactions** — market is done (`empire/marketFallback.ts`,
`empire/marketOrders.ts`, gh #60), so boosting is next, deliberately built *before* reactions rather than
after them the way the original plan assumed.

**This doc explicitly supersedes `boosting-reactions-plan.md`'s M2 (empire assignment algorithm — already
dead, per that doc's own `empire/boostTargets.ts` header), M3 (colony-scoped shortfall — folded into the
empire-logistics read below), M4 (terminal distribution — already superseded by `empire/logistics.ts`,
same as M2), and M7 (boosting flow) in full.** M0 (mineral harvesting) and M1 (lab snapshot state) are
unaffected and still apply as written — M1 is still unbuilt and is restated below only to note its
dependency, not to redesign it. M5 (reaction running) and M6 (lab logistics, shared mover) are deferred
past this doc's scope (boosting ships without reactions) — M6 is **not** shared with reactions here,
unlike the original plan's decision 3; see decision 9 below for why.

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`.
- Read order: this doc top to bottom, then `docs/boosting-competitor-research.md` (the six-bot survey
  every decision below cites by name), then `docs/empire-logistics-plan.md` + `src/empire/logistics.ts`
  (the empire-logistics seam this whole design routes through — `computeEmpireRequests`,
  `matchEmpireRequests`, `EmpireRequest`, `ColonyMemory.empireReservations`), then `src/empire/sponsor.ts` +
  `src/empire/drainSponsor.ts` (the real "operation creation fails" precedent this design extends — NOT a
  new mechanism, an existing one), then `src/behaviors/roles/role.ts` + the `runOne` pre-emption chain in
  `src/empire/creeps.ts:332` (`def.flee`/`def.retreatPart`'s exact shape — the boost hook slots in right
  next to these), then `src/empire/spawning.ts` (`planSpawning`'s `"spawn"` intent — NOT the trigger this
  design uses, see decision 6 for why it was rejected in favor of a snapshot read).
- No lab/boost code exists yet anywhere in `src/` (confirmed via grep: `runReaction`, `boostCreep`,
  `STRUCTURE_LAB` appear nowhere in `src/` except the recipe-graph reference in `empire/market.ts`, reused
  read-only by decision 10 below). This is greenfield.
- No memory entry exists yet for this effort — write one once M1 (of this doc's milestones) lands.

## The decisions (and why)

### 1. Operation-creation gate reuses the sponsor-pick precedent, doesn't invent a new mechanism
"Operation creation can fail" already exists in this codebase: `empire/sponsor.ts`'s `pickSponsor` /
`pickSponsorFor`, and per-operation wrappers like `drainSponsor.ts`, compute an affordability floor
(`SponsorConfig.minCost`) at flag/console-processing time, *before* the operation object is ever
constructed, and reject with an explicit `reason: "no colonies" | "unreachable" | "unaffordable"` logged
to console (`drainFlags.ts:50`'s `log.error(...no fitting colony...(${pick.reason}))`). A boosted operation
extends this exact mechanism with a fourth rejection reason — it does not need a new "operation
constructor that validates" pattern, since none of Overmind/Hivemind/KasamiBot/HoPGoldy's approaches map
onto how this codebase's `Operation` class works anyway (every operation here is a stateless,
`ColonySnapshot`-driven `desiredCreeps()` recomputed fresh every tick — see `operation.ts`'s own doc
comment — there is no persistent "create" call anywhere to hang validation off of except sponsor-pick).

**New rejection reason**: `"boostTierUnavailable"`, checked at the same sponsor-pick moment, immediately
after the existing `unaffordable` energy check (decision 2 covers exactly what it checks against).

### 2. The tier-availability check reads empire logistics, not a fresh local summation
Sponsor-pick's existing checks (`energyCapacity >= floor`) are colony-local instantaneous reads off
`Colony.snapshot`. A boost-tier check is different: compound isn't colony-local the way energyCapacity is
(a colony can be topped up by another colony's surplus or an emergency pull — decision 5), so the
naive "sum every colony's storage+terminal for this compound" would double-count stock other pending
matches or emergency requests have already claimed.

**`empire/logistics.ts` is the single point of truth for stock and demand, so sponsor-pick asks it, not a
duplicate summation in `sponsor.ts`.** Both modules already live at empire scope (`src/empire/`) — this is
a lateral read between two empire-level modules, not a layering violation the way empire code reaching down
into colony/role internals would be (see decision 6's `boostNeeds` field for that distinct concern). A new
exported read, `availableEmpireStock(resource): number`,
computed the same way the existing pass already computes deficits — summed `storage.getUsedCapacity +
terminal.getUsedCapacity` across every colony, **minus** every colony's current `ColonyMemory
.empireReservations[resource]` (stock already committed to leave this pass, so it can't be double-offered).
Sponsor-pick calls this once per candidate tier.

**This check is purely advisory — asking is not reserving.** Reserving stock at sponsor-pick time (writing
an "I'm claiming this" record before the operation even exists) was explicitly rejected: it would make
that stock briefly unavailable to every colony including the one that might actually consume it, for an
operation that might never get past sponsor-pick's OTHER checks (roomDistance/affordability) anyway. Two
operations created the same tick can both see "yes, 3000 X available" and both pass — this is the same
race `pickSponsor`'s existing `energyCapacity` check already has today (two flags placed the same tick
racing the same colony's energy) and this codebase has never needed to close that race. A boost-tier
shortfall discovered *after* creation just means a longer wait or an unboosted spawn, same class of
outcome as any other post-creation resource contention. energyCapacity self-corrects fast (regenerates
every tick); a T3 compound stockpile does not — accepted anyway, per the above reasoning, not because the
cost is equivalent, but because a real reservation mechanism doesn't exist anywhere in this codebase today
and inventing one here, for a rare, human-paced, flag-triggered path, isn't worth the new persisted state.

### 3. Forced tier vs. greedy tier — both, selected by flag/console syntax
Point 2 of the originating research request ("boost level T1-T3 is available on operation creation; if a
specific level is requested and not available, operation creation should fail") and the follow-up grilling
converged on supporting **both** of the two philosophies the competitor research found split across bots
(Overmind/Hivemind's dynamic best-available vs. KasamiBot/HoPGoldy's caller-fixed tier), rather than
picking one:

- **Forced tier**: flag/console syntax `operationName:RoomName:numCreeps:T3` pins an exact tier. Sponsor-pick
  checks `availableEmpireStock` for **exactly** that tier's compound(s) for the requested action set (per
  decision 4's `boostable` table) and rejects with `"boostTierUnavailable"` if short — no fallback to a
  lower tier, matching "if a specific level is requested and not available, operation creation should fail"
  literally.
- **Greedy tier**: `operationName:RoomName:numCreeps:T` (bare, no number) or an omitted tier suffix checks
  T3 first, falls to T2, then T1 — same shape as Overmind's `bestBoostAvailable` — **against empire-wide
  stock** (decision 2's read), not the sponsoring colony's own local stock, deliberately putting weight on
  the empire-logistics system actually delivering rather than favoring a tier that merely happens to sit
  locally already. The first tier with `availableEmpireStock >= required` for every action in the role's
  `boostable` list wins; if none of T3/T2/T1 clears the bar, sponsor-pick fails the same way the forced
  path does.

### 4. `Role.boostable`: a static action tag, not a body-part list
Body parts alone are ambiguous — one part (WORK) is boosted differently depending on the *action* applied
to it (harvest vs. build vs. upgradeController vs. dismantle vs. repair are different compounds, same
part, per the engine's own `BOOSTS[bodyPart][compound] = { actionType: multiplier }` shape). Every
researched bot that does dynamic tier selection (Overmind, Hivemind) keys off an abstract **action** name
for exactly this reason, not a raw `BodyPartConstant`.

`Role.boostable: readonly string[]` (e.g. Healer → `["heal", "tough"]`), colocated on `Role` next to
`flee`/`retreatPart`/`mover` — the same static opt-in shape every other cross-cutting behavior flag in this
codebase already uses. A thin reverse-index over the engine's own `BOOSTS` global (built once, lazily,
mirroring `market.ts`'s `buildReactionInputs`/`reactionInputsFor` memoization pattern exactly — decision 10
reuses this precedent directly) resolves `action -> bodyPart -> { T1: compound, T2: compound, T3: compound
}` — no hand-maintained part/tier table duplicating what `BOOSTS` already encodes.

### 5. Two-stage trigger: census presence pulls compound INTO the colony; spawning pulls it INTO the lab
Point 3's "request emergency boosts... triggered by the spawn request not the spawn request getting
actually started" and point 4's "lab stocking should be reactive... triggered on starting the spawning"
turned out to name two genuinely different moments in this codebase's vocabulary, confirmed against
`spawn/request.ts`/`empire/spawning.ts`:

- **Stage A — `desiredCreeps()` census presence.** The instant a colony's `desiredCreeps()` output for this
  tick includes a `CreepRequest` whose `memory.boosts` is set (regardless of whether `planSpawning`'s
  arbiter has picked it yet — a request can sit queued for many ticks first), that colony's outstanding
  boost need becomes visible to empire logistics. This is what fires the **emergency compound pull**
  (decision 6): move compound from wherever the empire has surplus INTO this colony's storage/terminal, so
  it's ready and waiting well before the creep is anywhere close to actually spawning.
- **Stage B — the creep exists, `spawning === true`, `memory.boosts` set.** `planSpawning` emitting a
  `"spawn"` intent does NOT guarantee `spawnCreep()` actually succeeded downstream (intents can still fail
  to apply) — so the real trigger is reading `colony.snapshot.creeps` (a `readonly SnapCreep[]`, exactly the
  same shape/access path every other operation already reads — `SnapCreep.spawning: boolean` and
  `SnapCreep.memory: DeepReadonly<CreepMemory>` both already exist, confirmed in `snapshot/types.ts` — never
  a live `Colony`/`Game.creeps` reach, per `operation.ts`'s "methods take `ColonySnapshot`, never `Colony`"
  rule) for a creep with `spawning === true && memory.boosts !== undefined`. This fires **lab stocking**:
  move compound from the colony's own storage/terminal (already topped up by stage A, ideally) into the
  specific static boost lab(s) (decision 8), ASAP, same urgency as HoPGoldy's `boostGetResource`/KasamiBot's
  `LoadHauler` stage.
- **Energy is gated behind the exact same stage-B trigger as compound** — not a separate "always full"
  standing policy independent of any pending order, matching how every researched bot that gates energy at
  all (Hivemind, HoPGoldy, KasamiBot) ties it to the same request, not a free-floating background fill.

No new persisted "did I already trigger this" flag is needed for either stage — both conditions
(census-presence, spawning-with-memory.boosts) are themselves the trigger, re-evaluated fresh every tick,
same as every other snapshot-driven check in this codebase.

### 6. Emergency compound requests are a new, higher-priority `EmpireRequest` kind — can drain a donor below its own target
`computeEmpireRequests`/`matchEmpireRequests` today only ever move a colony's *surplus* (stock above its
own standing target) — a colony's target floor is never touched by ordinary matching. Point 5 ("lab
stocking should be a high priority request for the intercolony logistics") and point 3's "emergency"
framing both imply something stronger than the existing surplus-only matcher: the ability to move a
donor colony's *stockpiled* (at-or-below-target) stock, not just its excess.

**A new request kind**, computed alongside (not instead of) the existing `EmpireRequest` deficit/surplus
pass, driven by stage A's census-presence trigger. **The amount is computed by the colony side, not by
`empire/logistics.ts` reaching into role/body internals to derive it itself** — the same layering the rest
of this codebase already enforces (`empire/spawning.ts`'s `planSpawning` never inspects a role's body
formula either; it only ever reads the `CreepRequest.body`/`.priority` a colony already computed and
handed up). Concretely: `CreepRequest` (`spawn/request.ts`) gains an optional `boostNeeds?:
Partial<Record<ResourceConstant, number>>` field — the exact compound-to-`LAB_BOOST_MINERAL`-amount map,
computed once by whichever colony-side code builds the boosted `CreepRequest` in the first place (it
already knows the tier from decision 3 and the action list from decision 4's `boostable` table, so it's the
only place that legitimately has both). `empire/logistics.ts`'s new emergency pass then just sums
`boostNeeds` across every colony's outstanding requests — a pure aggregation over data already handed to
it, never a derivation from a creep's body or a role's static table. This is matched **before** the
ordinary surplus-only pass and is allowed to pull from any donor colony's target-level stock, not only its
surplus above target.

**No floor protection on the donor.** An emergency request can drain a donor colony's stock for that
compound to zero if that's what fulfilling it requires. The donor's own resulting deficit reappears next
pass and gets refilled by the standing target policy exactly like any other deficit — treated as an
accepted cost of the compound having been spent on boosting (which is, after all, a real and legitimate use
of the stockpile), not a bug to guard against with a reservation floor. No new persisted "minimum floor"
concept was introduced for this — kept consistent with decision 2's broader "don't invent new persisted
state where the existing recompute-fresh-every-pass philosophy already covers the outcome."

### 7. The runtime hook: a static role tag PLUS a per-creep memory escape hatch — not either alone
`runOne` (`empire/creeps.ts:332`) already pre-empts its entire step table with two static opt-in checks
before dispatch: `if (def.flee && fleeThreat(creep)) return;` then `if (def.retreatPart &&
retreatIfDisarmed(creep, def.retreatPart)) return;`. Boosting needed BOTH halves of that shape, not one:

- **Static role tag** (`Role.boostable`, decision 4) — declares which roles can ever be boosted at all,
  checked first and cheaply, exactly like `def.flee`/`def.retreatPart`.
- **Per-creep runtime state** (`CreepMemory.boosts !== undefined`) — declares whether THIS specific creep
  instance currently has a pending order, mirroring KasamiBot's `creep.memory.boost`/TooAngel's
  `room.memory.boosts[creep.name]` pattern exactly (not Hivemind's purely role-level predicate, which has
  no per-instance memory at all).

`runOne` gains a pre-emption check, but — same reasoning as decision 8's ownership split — it needs the
tick's already-computed lab assignment handed in, not computed itself. `dispatchCreep`
(`empire/creeps.ts:161`) already receives one precomputed per-tick map as an extra argument
(`transportByHome: Map<string, Creep[]>`, built once before the creep loop starts) purely so per-creep
dispatch never has to recompute cross-creep state itself — `runOne` widens to the same shape:
`runOne(creep, boostLabAssignments)`, where `boostLabAssignments: Map<Id<Creep>, BoostLabAssignment>` is
decision 8's `planBoostLabAllocation` output, computed once before the creep loop (same place
`transportByHome` is built today) and threaded down exactly the way `transportByHome` already is. The
pre-emption check becomes: `if (def.boostable && creep.memory.boosts !== undefined) {
runBoostSteps(creep, boostLabAssignments.get(creep.id)); return; }` — full escape from the normal step
table (mirroring `flee`/`retreatPart`'s uniform pre-emption, not a `Step` variant threaded into `steps[]`,
which would need its own bespoke pre-emption logic duplicated from `firstRunnableStep`'s completion-skipping
behavior for no benefit). `runBoostSteps` reads only its own passed-in assignment (walks to the assigned
lab, if any, and calls `boostCreep()`; if the assignment is absent, steps aside per decision 8's scarcity
rule); once every entry in `memory.boosts` is satisfied, it's cleared, and the creep falls through to its
ordinary step table starting next tick — same self-clearing shape as every other opt-in memory field in
this codebase (`scoutTarget`, etc.).

### 8. Lab allocation: 3 static labs, aggregated demand per compound, finish-first priority under scarcity — computed ONCE, colony-scoped, read-only from each creep
**Static, not dynamic** (decision 9 covers the deferred dynamic/mode-switch extension). Every colony that
supports boosting at all permanently reserves 3 labs for it — never touched by reactions once M5 exists.
Chosen for implementation simplicity over the dynamic "labs move between purposes" alternative every
researched bot with a shared cluster does (Hivemind's claim/release, HoPGoldy's whole-cluster war-state
toggle) — deliberately deferred, not rejected (decision 9).

**Explicit ownership, to avoid a sibling-reaching backdoor**: the aggregation/readiness-priority/allocation
described below is NOT computed inside `runBoostSteps` (decision 7's per-creep, `runOne`-invoked function).
A single creep's step function has no business inspecting every other spawning creep's `memory.boosts` to
rank itself — that would be exactly the "operations can never reach and call siblings" violation
`operation.ts`'s own doc rules out. Instead, a new colony-scoped, per-tick, pure function follows the exact precedent
`lib/squad.ts`'s `planSquadActions` already established for "one shared plan, computed once, each member
reads only its own slice": `planBoostLabAllocation(colony: ColonySnapshot): Map<Id<Creep>, BoostLabAssignment>`,
called once per colony per tick (same dispatch tier `runSquads` already calls `planSquadActions` from,
`empire/creeps.ts`). It scans every creep with `spawning === true && memory.boosts !== undefined`,
aggregates compound demand, resolves scarcity via the readiness rule, and produces one map entry per
relevant creep (which lab, if any, it's assigned to this tick; absent/`undefined` means "step aside and
wait"). `runOne`'s dispatch passes that tick's already-computed map down to `runBoostSteps` as a plain
argument — same shape `runSquadMember(creep, to, actions.get(move.creep))` already uses to hand one squad
member its own `ActionIntent` — so `runBoostSteps` only ever reads the single `Map.get(creep.id)` entry
that's already been resolved for it. No `CreepMemory` write is needed for the assignment itself (it's
transient, recomputed fresh every tick, same as `matchEmpireRequests`'s own matches per decision 11 of
`empire/logistics.ts`); `runBoostSteps` never computes ranking itself and never reads another creep's
memory directly.

**Compound requests aggregate at the lab/compound level, not per creep.** If creep A needs 400 of compound
X and creep B (spawning in parallel — this codebase's spawning is genuinely concurrent across multiple
spawns) also needs 400 of X, that's a single logistics pull for 800 into one lab, not two separate 400
pulls — same lab, same compound, no per-creep bookkeeping on the request side at all. This is a real
efficiency the naive "exclusive stocking, one order in flight at a time" alternative would have missed.

**Priority only activates under genuine scarcity — distinct compounds competing for the capped 3 physical
slots.** When two+ creeps need *different* compounds and there aren't enough free labs for all of them:
- The creep with the most of its needed labs **already stocked and ready to fire** wins the contested
  slot(s) — i.e., readiness, not queue order or raw remaining-action count. A creep needing 3 boosts with
  2 already ready outranks one needing 1 boost with 0 ready.
- This is explicitly an **anti-stalemate** rule: splitting stocking effort evenly across two competing
  creeps would let both sit forever at "almost ready, never complete." The rule's job is to make sure the
  cluster's scarce slots commit toward whichever order will actually finish soonest, not to optimize some
  other fairness metric.
- **When the competing creeps need the SAME compound, there is no conflict at all** — the request simply
  aggregates (see above) and both benefit from the same fill; priority logic is never invoked for
  same-compound demand, only for cross-compound scarcity.
- A creep that loses the contest for a lab **steps aside and waits** (moves off the lab-adjacent tile) —
  it does not block the tile for the winner. This is also a genuine physical constraint, not just a
  courtesy: `boostCreep()` requires range-1 adjacency to the specific lab, so the cluster's tile layout
  itself caps how many creeps can be mid-boost at any moment independent of compound accounting.
- **`boostCreep()` is inherently serial per lab** — one creep drains a shared aggregated stock at a time
  (the engine has no multi-creep-per-call boost), so "aggregated demand" only ever describes the compound
  *request* size, never simultaneous consumption. A lab naturally returns to empty once every creep drawing
  against its aggregated stock has been served in turn — no separate "clean the lab" step is needed for the
  ordinary case (a boost order that runs to completion); genuine leftovers (an order cancelled mid-flight,
  a creep that died before consuming its share) are the only case needing an explicit sweep, and that sweep
  is out of this doc's scope to fully design (noted as a small open edge, not a milestone).

### 9. Frontline/backline lab-capacity mode switch — explicitly deferred, not designed
Point 6 of the original request ("a mode switch... to free the dedicated labs for boosting to
reactioning") is real and motivated — a colony far from any front has no boosting need and could instead
dedicate its 3 static lab slots to reaction production once M5 exists — but is explicitly **out of scope
for this doc**, same treatment `boosting-reactions-plan.md` gave "Local demand override" and "Market
buying" (both flagged, neither designed, until their own dedicated grilling sessions). The natural anchor
point once it IS designed: `ColonyMemory.empireRole` (`"frontline" | "backline" | undefined`) already
exists (`empire-logistics-plan.md` decision 3) and already biases `effectiveTargetFor` — a lab-capacity
mode switch would plausibly read the same field rather than inventing a second frontline/backline concept,
but that reuse is a future decision, not one made here.

### 10. Boost-tier/compound lookup reuses `market.ts`'s memoization pattern, not its recipe graph
`market.ts` already has `REACTIONS`-derived lookups (`buildReactionInputs`/`reactionInputsFor`, lazily
memoized on first use, built from the engine global rather than hand-typed — `market.ts:50-67`) for
reaction *recipes*. Boosting needs a structurally similar but distinct lookup — action name to
part/compound/tier, derived from the engine's `BOOSTS` global, not `REACTIONS` — so the new lookup lives
in its own module (not inside `market.ts`, which is reaction/trading-scoped) but explicitly copies the
"lazy, memoized, built from the real engine constant rather than recalled/hand-typed" shape `market.ts`
already established and validated.

## Milestones

Each scoped to be its own session, same convention as `boosting-reactions-plan.md`.

### B1 — Lab state in the snapshot
Same as the original plan's M1, restated here only for dependency completeness — not redesigned. Add lab
representation to `ColonySnapshot`: position, `mineralType`, `mineralAmount`, `energy`, `cooldown`, same
shape as `SnapLink`. No behavior, just the read path B2+ needs.
- **Validates independently**: snapshot lab fields match `Game.rooms[x].find(FIND_MY_STRUCTURES)` labs
  filtered to `STRUCTURE_LAB`.

### B2 — Boost lookup table (decision 4, decision 10)
The `action -> bodyPart -> {T1,T2,T3 compound}` reverse-index over the engine's `BOOSTS` global, lazily
memoized, new standalone module. Pure, no game-state dependency beyond the constant itself.
- **Validates independently**: given a known action name (e.g. `"heal"`), returns the correct compound for
  each tier, matching `BOOSTS[HEAL]` by hand-checked spot values.

### B3 — `Role.boostable` + `CreepMemory.boosts` + the `runOne` escape hatch (decision 7)
Add the static tag to `Role`, the memory field to `CreepMemory`, and the pre-emption check to `runOne`
(widened to accept the precomputed per-tick assignment map, same shape as `dispatchCreep`'s existing
`transportByHome` parameter). `runBoostSteps` itself can be a stub at this stage that ignores its assignment
argument (walks toward a hardcoded/no-op target regardless of what's passed in) — this milestone is about
the escape-hatch plumbing working correctly (a tagged creep with `memory.boosts` set really does skip its
normal steps and falls back through once cleared) and the parameter threading through cleanly, not the real
lab interaction yet (that's B5/B6, once `planBoostLabAllocation` exists to actually populate the map).
- **Validates independently**: a boostable-role test creep with `memory.boosts` set never runs its normal
  step table; clearing the field lets it resume next tick; `runOne` correctly passes through an (empty, at
  this stage) assignment map without needing to compute anything itself.

### B4 — `availableEmpireStock` read + sponsor-pick tier gate (decisions 1-3)
New export on `empire/logistics.ts`; new `"boostTierUnavailable"` reason on the sponsor-pick result type;
forced-tier and greedy-tier syntax parsing on whichever flag/console command creates a boostable operation
first (pick one real operation to wire this into, e.g. Drain, rather than building it generically before
any caller exists).
- **Validates independently**: given fake empire stock stubs, a forced-tier request correctly fails when
  short and succeeds when available; a greedy request correctly walks T3→T2→T1 and fails only if all three
  are short.

### B5 — Emergency `EmpireRequest` + lab allocation with finish-first priority (decisions 5, 6, 8)
The two-stage trigger (census presence → emergency pull; spawning+memory.boosts → lab fill), the new
high-priority no-floor request kind (fed by `CreepRequest.boostNeeds`, computed colony-side per decision 6
— never derived by `empire/logistics.ts` itself from role/body internals), and
`planBoostLabAllocation(colony): Map<Id<Creep>, BoostLabAssignment>` — the colony-scoped, computed-once
aggregation/priority/step-aside pass decision 8 requires, called once per colony per tick from the same
place `transportByHome` is built today (`empire/creeps.ts`) and threaded into `runOne` as its new parameter.
The largest milestone — likely worth splitting into its own sub-sessions (stage A alone, then stage B alone,
then the allocation pass) rather than one sitting, flagged here rather than pre-split since the natural
seams will be clearer once B1-B4 exist to build against.
- **Validates independently**: given a colony snapshot with an outstanding boosted `CreepRequest` (with
  `boostNeeds` set) and an empire with surplus elsewhere, an emergency transfer intent moves compound in;
  given a spawning creep with `memory.boosts` set and compound now in colony storage, a lab-fill intent
  moves it into an assigned lab; given two creeps needing different compounds and only enough lab capacity
  for one, `planBoostLabAllocation` alone (no `runBoostSteps`/creep involvement needed to test this) assigns
  the more-ready creep and leaves the other's map entry absent, without deadlocking.

### B6 — `boostCreep()` execution (closes B3's stub)
`runBoostSteps` calls the real `boostCreep()` once the assigned lab is stocked, clears satisfied entries
from `memory.boosts`, and releases the creep back to its normal step table once the list is empty.
- **Validates independently**: given a colony snapshot with a lab holding sufficient stocked compound+energy
  and a creep positioned adjacent with `memory.boosts` set, the correct sequence of
  transfer/allocation/`boostCreep` intents fires across ticks and the creep resumes normal behavior once
  done.

## Future extensions (explicitly not milestones — write down, don't build yet)
- **Frontline/backline lab-capacity mode switch** (decision 9) — read `ColonyMemory.empireRole` to decide
  whether a colony's 3 static labs stay boost-reserved or get freed for reaction use once M5 exists.
- **Leftover-lab cleanup sweep** (decision 8's tail note) — an explicit reclaim path for compound stranded
  in a lab when its boost order is cancelled or its creep dies mid-order, rather than relying on the
  ordinary "drains to empty as creeps are served" happy path.
- **Reactions (M5/M6 from the original plan)** — deliberately built after boosting per the stated goal
  order; M6's "shared lab logistics mover" is explicitly NOT shared with boosting's lab-fill mechanism in
  this design (decision 8's aggregation/priority logic is boost-specific), so M6, if it still gets built at
  all once reactions arrive, will need its own scoping session rather than assuming reuse.
