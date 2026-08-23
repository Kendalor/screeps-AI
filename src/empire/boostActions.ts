// Reverse-index over the engine's BOOSTS constant (gh #61 epic, gh #62): resolves an abstract boost
// action name (e.g. "heal", "tough" — Role.boostable's vocabulary, see role.ts) to the one body part it
// targets and the compound for each of the three tiers. No consumer is wired up yet; this is the lookup
// table alone, mirroring src/empire/market.ts's buildReactionInputs/reactionInputsFor lazy-memoization
// pattern for the same reason (importing this module must not require the Screeps runtime constants to
// exist yet, e.g. under test).
//
// The real BOOSTS shape is BOOSTS[bodyPart][compound][action] = multiplier (verified against
// node_modules/@screeps/common/lib/constants.js, not recalled). A given (bodyPart, action) pair always
// has exactly 3 compounds in the real table — the T1/T2/T3 line for that action — so tiers are derived by
// ranking those 3 compounds, not by hand-typing a compound list. Every action's multiplier increases
// tier-over-tier EXCEPT tough's `damage`, which is a damage-taken multiplier where lower is stronger
// (0.7/0.5/0.3) — see src/lib/combat.ts's TOUGH_BOOST_MULTIPLIER for the same inversion. Ranking by
// "distance from the unboosted baseline of 1.0" (i.e. |multiplier - 1|) handles both cases with one rule:
// it increases monotonically with tier for every action in the real table, boost or reduction alike.
//
// Three body parts (tough/move/carry) have exactly one action apiece in the real table, and the engine's
// own key for it isn't a natural "action verb" the rest of this codebase would ever spell out — it's
// "damage"/"fatigue"/"capacity", an implementation detail of what the multiplier scales. Role.boostable's
// existing convention (SimpleHealerRole's `["heal", "tough"]`) already names the BODY PART "tough" as the
// action for that line, matching how a human/this codebase actually talks about boosting a creep ("tough
// boosts", "move boosts", "carry boosts") rather than the engine's internal field name. So for any body
// part with exactly one action, that action is ALSO indexed under the body part's own name — an alias, not
// a second independent action — so both `boostActionFor("tough")` and (if the engine key were ever looked
// up directly) `boostActionFor("damage")` resolve to the same T1/T2/T3 line. Multi-action parts (work,
// attack, ranged_attack, heal) are untouched: their engine keys are already the natural verbs
// ("attack", "harvest", "heal", ...) so no alias is needed or added.

export type BoostAction =
  | { kind: "found"; bodyPart: BodyPartConstant; T1: ResourceConstant; T2: ResourceConstant; T3: ResourceConstant }
  | { kind: "not-found"; action: string };

interface BoostLine {
  bodyPart: BodyPartConstant;
  T1: ResourceConstant;
  T2: ResourceConstant;
  T3: ResourceConstant;
}

function buildBoostActions(): Map<string, BoostLine> {
  // action -> compound -> multiplier, gathered across every body part/compound in BOOSTS. An action name
  // is unique to one body part in the real table (e.g. "attack" only ever appears under the attack part),
  // so no part-collision handling is needed here.
  const byAction = new Map<string, { bodyPart: BodyPartConstant; compounds: [ResourceConstant, number][] }>();

  // @types/screeps types BOOSTS as a union of per-part literal shapes (fine for game code that indexes
  // with a known-at-compile-time bodyPart/compound), which can't be walked generically by key the way
  // this reverse-index needs to. Cast to the same permissive shape market.ts uses for REACTIONS/
  // COMMODITIES, whose real runtime values are this file's whole reason for existing anyway.
  const boosts = BOOSTS as unknown as Record<string, Record<string, Record<string, number>>>;

  for (const bodyPart of Object.keys(boosts) as BodyPartConstant[]) {
    const compoundTable = boosts[bodyPart];
    for (const compound of Object.keys(compoundTable) as ResourceConstant[]) {
      const actionTable = compoundTable[compound];
      for (const action of Object.keys(actionTable)) {
        const multiplier = actionTable[action];
        let entry = byAction.get(action);
        if (!entry) {
          entry = { bodyPart, compounds: [] };
          byAction.set(action, entry);
        }
        entry.compounds.push([compound, multiplier]);
      }
    }
  }

  // Count actions per body part first, so the single-action alias below (tough/move/carry) only ever
  // fires for parts that genuinely have just one action in the real table — never silently masking a
  // second action a future engine update might add under the same part.
  const actionsPerPart = new Map<BodyPartConstant, string[]>();
  for (const [action, { bodyPart }] of byAction) {
    const list = actionsPerPart.get(bodyPart) ?? [];
    list.push(action);
    actionsPerPart.set(bodyPart, list);
  }

  const lines = new Map<string, BoostLine>();
  for (const [action, { bodyPart, compounds }] of byAction) {
    // Rank by effect strength (distance from the unboosted 1.0 baseline), weakest first, so index 0/1/2
    // map onto T1/T2/T3 regardless of whether higher or lower multipliers are stronger for this action.
    const ranked = [...compounds].sort((a, b) => Math.abs(a[1] - 1) - Math.abs(b[1] - 1));
    const [T1, T2, T3] = ranked.map(([compound]) => compound);
    if (!T1 || !T2 || !T3) continue;
    const line: BoostLine = { bodyPart, T1, T2, T3 };
    lines.set(action, line);
    // Single-action-part alias — see this file's header. bodyPart itself doubles as a valid action key
    // ("tough"/"move"/"carry") wherever the engine's own action name ("damage"/"fatigue"/"capacity")
    // wouldn't otherwise be findable under that friendlier name.
    if (actionsPerPart.get(bodyPart)?.length === 1) lines.set(bodyPart, line);
  }
  return lines;
}

// Lazy + memoized: built from the BOOSTS global on first use, not at module load — see this file's
// header and market.ts's identical rationale for reactionInputsCache.
let boostActionsCache: Map<string, BoostLine> | undefined;

/** Resolves an abstract boost action name (e.g. "heal", "tough", "upgradeController") to the body part it
 * targets and its T1/T2/T3 compounds. Returns a `{ kind: "not-found" }` result for an unknown action
 * name rather than throwing or returning undefined-shaped data. */
export function boostActionFor(action: string): BoostAction {
  boostActionsCache ??= buildBoostActions();
  const line = boostActionsCache.get(action);
  if (!line) return { kind: "not-found", action };
  return { kind: "found", ...line };
}
