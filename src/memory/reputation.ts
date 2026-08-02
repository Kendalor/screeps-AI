// Player reputation: the one place "is this owner dangerous" gets decided, so pathing/colonization
// consumers ask this instead of each inventing their own owner-name special-casing. Editable by hand from
// the console (Memory.playerReputation[name] = "hostile") and bumped automatically when we observe a
// player's creep actually attack us (see recordHostileAction / kernel's hostile-action scan) — the user
// explicitly wants both, since manual upkeep alone misses attacks while they're away.

export type Reputation = "friendly" | "neutral" | "hostile" | "dangerous";

// NPC owners are fixed regardless of Memory.playerReputation — never set by the auto-scan, never
// console-editable. Source Keeper is "dangerous" (its lair guardians are the reason issue 2 exists at
// all), Invader is merely "hostile" (a real but unremarkable raider, same tier a hostile player gets).
const NPC_REPUTATION: Record<string, Reputation> = {
  Invader: "hostile",
  "Source Keeper": "dangerous"
};

export function reputationOf(username: string | undefined): Reputation {
  if (!username) return "neutral";
  return NPC_REPUTATION[username] ?? Memory.playerReputation?.[username] ?? "neutral";
}

// What route/cost-matrix avoidance actually keys on: hostile and dangerous both mean "steer away from
// this", differing only in how strongly (see reputationCost) — friendly/neutral never trigger avoidance.
export function isDangerous(username: string | undefined): boolean {
  const rep = reputationOf(username);
  return rep === "hostile" || rep === "dangerous";
}

// Bumps a player to "hostile" the first time we see their creep attack one of ours. Never downgrades an
// existing "dangerous" (a manually-escalated rating outranks an auto-detected one) and never touches NPCs
// (fixed in NPC_REPUTATION above, not stored in Memory at all).
export function recordHostileAction(username: string): void {
  if (username in NPC_REPUTATION) return;
  const reputation = (Memory.playerReputation ??= {});
  if (reputation[username] === "dangerous") return;
  reputation[username] = "hostile";
}
