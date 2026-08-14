// In-game console commands, installed onto `global` so they're callable from the Screeps console
// (e.g. `setLogLevel("info")`). Each command self-registers into COMMANDS so help() stays accurate
// without a second list to keep in sync.

import { empire } from "../empire";
import { scanMarketNow, manufacturingCost, formatManufacturingCost } from "../empire/market";
import type { LogLevel } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import { listColonizeCandidates } from "../empire/pickColonyTargets";
import { execute } from "../intents/execute";
import { SPAWNABLE_OPERATIONS } from "../operations";
import { Mining } from "../operations/mining";
import { needsScouting, staleAfter } from "../behaviors/scout";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import { SETTLER_MIN_COST } from "../behaviors/roles/settler";
import { ATTACKER_MIN_COST } from "../behaviors/roles/attacker";
import { DRAIN_ATTACKER_MIN_COST } from "../behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../behaviors/roles/drainHealer";
import { PARADE_MEMBER_MIN_COST } from "../behaviors/roles/paradeMember";
import {
  claimsOf,
  builtAt,
  existingAt,
  sitesAt,
  roomOf,
  unsafeRemoteRooms,
  wantedStructures,
  FOCUS_SITE_CAP,
  MAX_CONTAINER_SITES
} from "../colony/building";

const VALID: LogLevel[] = ["error", "warn", "info"];

const REASON_LABEL: Record<string, string> = {
  remoteMiningOverlap: "already a remote",
  tooClose: "too close to an owned colony",
  tooFar: "too far from any owned colony",
  unreachable: "unreachable"
};

interface FlagOperationInfo {
  kind: string;
  trigger: string;
  // The sponsor-pick floor (colonizeSponsor.ts/attackSponsor.ts/drainSponsor.ts/paradeSponsor.ts): a
  // colony below this energyCapacity is never offered the flag's target at all, regardless of anything
  // else — the flag just sits unresolved (logged every tick) until some colony crosses this line.
  minEnergyCapacity: number;
  gateDetail: string;
  spawns: string;
}

const DRAIN_SQUAD_MIN_COST = Math.max(DRAIN_ATTACKER_MIN_COST, DRAIN_HEALER_MIN_COST);

// One entry per Operation that's attached via a flag/CLI handoff rather than unconditionally
// (operationsFor() in operations/index.ts) — mirrors SPAWNABLE_OPERATIONS' hand-kept list, but for the
// sponsor-pick affordability floor instead of "what attaches it." See each *Sponsor.ts file's own
// `affordable = colonies.filter(...)` line for where these numbers come from.
const FLAG_OPERATIONS: readonly FlagOperationInfo[] = [
  {
    kind: "colonize",
    trigger: 'flag "colonize" or "colonize:<room>" (or auto-pick via pickColonyTargets)',
    minEnergyCapacity: COLONIZER_COST,
    gateDetail: "cheapest legal colonizer body (1 CLAIM set) — colonizeSponsor.ts",
    spawns: `1 colonizer (claims the controller, min ${COLONIZER_COST}e) + up to 4 settlers once claimed (min ${SETTLER_MIN_COST}e each)`
  },
  {
    kind: "attack",
    trigger: 'flag "attack" or "attack:<room>"',
    minEnergyCapacity: ATTACKER_MIN_COST,
    gateDetail: "cheapest legal attacker body (1 ATTACK set) — attackSponsor.ts",
    spawns: `up to 2 attackers pooled across every sponsored target (min ${ATTACKER_MIN_COST}e each)`
  },
  {
    kind: "drain",
    trigger: 'flag "drain" or "drain:<room>" — flag is the operation\'s lifetime, removing it stops the drain',
    minEnergyCapacity: DRAIN_SQUAD_MIN_COST,
    gateDetail: "most expensive single body in the fixed squad (max of drainAttacker/drainHealer min cost) — drainSponsor.ts",
    spawns: `1 drainAttacker (min ${DRAIN_ATTACKER_MIN_COST}e) + 3 drainHealers (min ${DRAIN_HEALER_MIN_COST}e each)`
  },
  {
    kind: "parade",
    trigger: 'flag "parade", "parade:<shape>", "parade:<room>", or "parade:<room>:<shape>" — flag is the operation\'s lifetime',
    minEnergyCapacity: PARADE_MEMBER_MIN_COST,
    gateDetail: "cheapest legal paradeMember body (2 MOVE) — paradeSponsor.ts",
    spawns: `formation.length paradeMembers (default 2x2 = 4, min ${PARADE_MEMBER_MIN_COST}e each)`
  }
];

declare global {
  function setLogLevel(level: LogLevel): string;
  function setDebugMetrics(on: boolean): string;
  function debugCreep(name: string): string;
  function undebugCreep(name: string): string;
  function debugColony(room: string): string;
  function undebugColony(room: string): string;
  function clearDebug(): string;
  function resetDebug(): string;
  function spawnLoad(room?: string): string;
  function buildPlan(room: string): string;
  function remoteStatus(room: string): string;
  function miningClaims(room: string): string;
  function operationKinds(): string;
  function operationRequirements(): string;
  function colonizeTargets(): string;
  function scoutStatus(room?: string): string;
  function scoutInfo(room: string): string;
  function scanMarket(): string;
  function manufactureCost(resource: string, includeDecompress?: boolean): string;
  function clearDrainTarget(room: string): string;
  function removeOperation(kind: string, room: string, target?: string): string;
  function help(): string;
}

// name -> one-line usage/description, printed by help() in registration order.
const COMMANDS: [string, string][] = [];

function register(usage: string, description: string): void {
  COMMANDS.push([usage, description]);
}

export function installConsoleCommands(): void {
  // Idempotent: installConsoleCommands() is called once at module scope in production (see main.ts),
  // but a re-call (e.g. tests re-installing per case) must not duplicate help() entries.
  COMMANDS.length = 0;

  global.setLogLevel = (level: LogLevel): string => {
    if (!VALID.includes(level)) return `invalid log level "${level}"; use one of: ${VALID.join(", ")}`;
    Memory.logLevel = level;
    return `log level set to "${level}"`;
  };
  register("setLogLevel(level)", `set the log level; one of ${VALID.join(", ")}`);

  global.setDebugMetrics = (on: boolean): string => {
    Memory.debugMetrics = on;
    return `debug metrics ${on ? "enabled" : "disabled"}`;
  };
  register("setDebugMetrics(on)", "toggle the right-aligned debug panel (remote repair + remote source status)");

  global.debugCreep = (name: string): string => {
    const list = (Memory.debugCreeps ??= []);
    if (!list.includes(name)) list.push(name);
    return `debug logging enabled for creep "${name}"`;
  };
  register("debugCreep(name)", "trace one creep's per-tick task/step decisions via log.debugCreep");

  global.undebugCreep = (name: string): string => {
    if (Memory.debugCreeps) Memory.debugCreeps = Memory.debugCreeps.filter(n => n !== name);
    return `debug logging disabled for creep "${name}"`;
  };
  register("undebugCreep(name)", "stop tracing a creep enabled via debugCreep");

  global.debugColony = (room: string): string => {
    const list = (Memory.debugColonies ??= []);
    if (!list.includes(room)) list.push(room);
    return `debug logging enabled for colony "${room}"`;
  };
  register("debugColony(room)", "trace one colony's per-tick spawn requests via log.debugRoom");

  global.undebugColony = (room: string): string => {
    if (Memory.debugColonies) Memory.debugColonies = Memory.debugColonies.filter(r => r !== room);
    return `debug logging disabled for colony "${room}"`;
  };
  register("undebugColony(room)", "stop tracing a colony enabled via debugColony");

  global.clearDebug = (): string => {
    Memory.debugCreeps = [];
    Memory.debugColonies = [];
    return "cleared all debug-traced creeps and colonies";
  };
  register("clearDebug()", "clear every creep/colony currently opted into debug tracing");

  global.resetDebug = (): string => {
    Memory.logLevel = "error";
    Memory.debugMetrics = false;
    Memory.debugCreeps = [];
    Memory.debugColonies = [];
    return "debug settings reset: logLevel=error, debugMetrics off, all traced creeps/colonies cleared";
  };
  register("resetDebug()", "reset every debug setting at once (logLevel, debug panel, traced creeps/colonies) back to quiet defaults");

  global.spawnLoad = (room?: string): string => {
    const world = empire(buildEmpireSnapshot());
    const colonies = room ? world.colonies.filter(c => c.name === room) : world.colonies;
    if (colonies.length === 0) return room ? `no colony "${room}"` : "no colonies";
    return colonies
      .map(c => {
        const livingParts = c.snapshot.creeps.reduce((sum, cr) => sum + cr.body.length, 0);
        const requestedParts = c.requestParts();
        const parts = livingParts + requestedParts;
        const capacity = c.snapshot.spawns.length * 500;
        const load = capacity > 0 ? parts / capacity : 0;
        return `${c.name}: load=${(load * 100).toFixed(1)}% parts=${parts} (living=${livingParts} requested=${requestedParts}) capacity=${capacity}`;
      })
      .join("\n");
  };
  register("spawnLoad(room?)", "true spawn load: living + outstanding-request parts / capacity, matching the panel exactly");

  global.buildPlan = (room: string): string => {
    const world = empire(buildEmpireSnapshot());
    const c = world.colonies.find(col => col.name === room);
    if (!c) return `no colony "${room}"`;
    const snapshot = c.snapshot;
    if (!snapshot.anchor) return `${room}: no anchor resolved yet — building() is a no-op`;

    // Same inputs placeAndDemolish() itself uses: every operation's claims (Mining's source routes,
    // the bunker layout, etc.), then the throttled/gated plan (one source group at a time — see
    // gateSourceGroups) in the exact order placeAndDemolish would place them.
    const claimed = claimsOf(snapshot, c.operations);
    const plan = wantedStructures(snapshot, claimed);
    const unsafeRemote = unsafeRemoteRooms(snapshot);

    const cap = Math.min(FOCUS_SITE_CAP, MAX_CONSTRUCTION_SITES);
    let homeBudget = cap - snapshot.siteSummary.filter(s => s.room === snapshot.name).length;
    let remoteBudget = cap - snapshot.siteSummary.filter(s => s.room !== snapshot.name).length;
    let containerSites = snapshot.siteSummary.filter(s => s.type === "container").length;

    const lines = plan.map((p, i) => {
      const targetRoom = roomOf(p, snapshot);
      const home = targetRoom === snapshot.name;
      const tag = p.sourceId ? ` [source ${p.sourceId}]` : "";
      const pos = `${targetRoom}(${p.x},${p.y})`;

      if (builtAt(snapshot, p)) return `${i + 1}. ${p.type}@${pos}${tag} — built`;
      if (sitesAt(snapshot, targetRoom).some(s => s.x === p.x && s.y === p.y && s.type === p.type)) {
        return `${i + 1}. ${p.type}@${pos}${tag} — site already placed`;
      }

      // Mirror placeAndDemolish's own skip order so "why isn't this placed yet" reads the same way live.
      if (home ? homeBudget <= 0 : remoteBudget <= 0) return `${i + 1}. ${p.type}@${pos}${tag} — queued (${home ? "home" : "remote"} site budget full)`;
      if (!home && unsafeRemote.has(targetRoom)) return `${i + 1}. ${p.type}@${pos}${tag} — blocked (${targetRoom} unsafe: danger or foreign reservation)`;
      if (p.type === "container" && containerSites >= MAX_CONTAINER_SITES) {
        return `${i + 1}. ${p.type}@${pos}${tag} — queued (container site cap reached)`;
      }
      if (existingAt(snapshot, p)) return `${i + 1}. ${p.type}@${pos}${tag} — built`; // built via routeBuilt, not a live structure match

      if (p.type === "container") containerSites++;
      if (home) homeBudget--;
      else remoteBudget--;
      return `${i + 1}. ${p.type}@${pos}${tag} — WOULD PLACE this tick`;
    });

    if (lines.length === 0) return `${room}: nothing planned — building() has no outstanding claims`;
    return `${room}: build plan (${plan.length} entries, home budget=${cap - snapshot.siteSummary.filter(s => s.room === snapshot.name).length}, remote budget=${cap - snapshot.siteSummary.filter(s => s.room !== snapshot.name).length})\n${lines.join("\n")}`;
  };
  register(
    "buildPlan(room)",
    "list every planned structure for a colony in placement order (home + remote, gated the same way building() gates — one remote source group at a time), tagged built/sited/would-place/blocked"
  );

  global.remoteStatus = (room: string): string => {
    const world = empire(buildEmpireSnapshot());
    const c = world.colonies.find(col => col.name === room);
    if (!c) return `no colony "${room}"`;
    const remotes = c.snapshot.remoteSources;
    if (remotes.length === 0) return `${room}: colony.remoteSources is empty (nothing selected, or none read from Memory)`;
    return remotes
      .map(
        s =>
          `${s.room} source ${s.id}: distance=${s.distance} reserved=${s.reserved} reservedBy=${s.reservedBy ?? "-"} ` +
          `danger=${s.danger} openTiles=${s.openTiles} route=${s.route ? `${s.route.length} tiles` : "MISSING"} ` +
          `routeBuilt=${s.routeBuilt ?? "-"}`
      )
      .join("\n");
  };
  register("remoteStatus(room)", "dump colony.remoteSources exactly as building()/mining() see it this tick — route length, danger, reservedBy, routeBuilt");

  global.miningClaims = (room: string): string => {
    const world = empire(buildEmpireSnapshot());
    const c = world.colonies.find(col => col.name === room);
    if (!c) return `no colony "${room}"`;
    const snapshot = c.snapshot;
    if (!snapshot.anchor) return `${room}: no anchor resolved yet`;
    // Isolated from claimsOf's operation list/dedup entirely — calls Mining.structures() directly with
    // no `planned` obstacles, so this can't be affected by a sibling operation's claims or ordering.
    const mining = new Mining(room);
    const claims = mining.structures(snapshot, []);
    const local = claims.filter(cl => (cl.room ?? room) === room);
    const remote = claims.filter(cl => (cl.room ?? room) !== room);
    const byRoom = new Map<string, number>();
    for (const cl of remote) byRoom.set(cl.room!, (byRoom.get(cl.room!) ?? 0) + 1);
    return (
      `${room}: Mining.structures() -> ${claims.length} total (${local.length} local, ${remote.length} remote)\n` +
      `remote by room: ${[...byRoom.entries()].map(([r, n]) => `${r}=${n}`).join(", ") || "none"}\n` +
      `colony.remoteSources.length=${snapshot.remoteSources.length}`
    );
  };
  register("miningClaims(room)", "call Mining.structures() directly (bypassing claimsOf's operation list) to isolate whether remote road/container claims are generated at all");

  global.operationKinds = (): string => {
    return SPAWNABLE_OPERATIONS.map(op => `${op.kind} — ${op.trigger}`).join("\n");
  };
  register("operationKinds()", "list every operation kind that can request a creep spawn, and what attaches it to a colony");

  global.operationRequirements = (): string => {
    return FLAG_OPERATIONS.map(op => {
      const gate = `needs energyCapacity >= ${op.minEnergyCapacity} (${op.gateDetail})`;
      return `${op.kind} — trigger: ${op.trigger}\n  sponsor gate: ${gate}\n  spawns: ${op.spawns}`;
    }).join("\n");
  };
  register(
    "operationRequirements()",
    "list every flag/CLI-triggerable operation (colonize, attack, drain, parade): how to trigger it and the energyCapacity a colony must have before pickSponsor will hand it the target (current live per-role staffing is census(), not this)"
  );

  global.colonizeTargets = (): string => {
    const world = empire(buildEmpireSnapshot());
    const listing = listColonizeCandidates(world);
    if (listing.length === 0) return "no colonize candidates known yet — scout more rooms";
    return listing
      .map(c => {
        const dist = Number.isFinite(c.distance) ? c.distance : "-";
        const viability = c.reason ? REASON_LABEL[c.reason] : "viable";
        const mineral = c.mineral ?? "none";
        return `${c.room}: score=${c.score.toFixed(1)} distance=${dist} mineral=${mineral} (${viability})`;
      })
      .join("\n");
  };
  register("colonizeTargets()", "list every cached colonize candidate, sorted by score, with distance and auto-pick viability");

  global.scoutStatus = (room?: string): string => {
    const world = empire(buildEmpireSnapshot());
    const colonies = room ? world.colonies.filter(c => c.name === room) : world.colonies;
    if (colonies.length === 0) return room ? `no colony "${room}"` : "no colonies";

    const radius = Memory.scouting?.radius ?? 1;
    const lines = colonies.map(c => {
      const snapshot = c.snapshot;
      const scouts = snapshot.creeps.filter(cr => cr.memory.role === "scout");
      const frontier = snapshot.scoutTargets.filter(t => t.room !== snapshot.name);
      const stale = frontier.filter(t => needsScouting(t, snapshot.tick));
      const neverSeen = frontier.filter(t => !t.info || t.info.tick === undefined);
      const scoutLines = scouts.map(s => {
        const target = s.memory.scoutTarget ?? "-";
        const last = s.memory.lastRoom ?? "-";
        const stranded = s.room === snapshot.name && s.memory.scoutTarget === undefined && s.memory.lastRoom === undefined;
        return `  ${s.name}: room=${s.room} target=${target} lastRoom=${last}${stranded ? " STRANDED" : ""}`;
      });
      return (
        `${c.name}: radius=${radius} frontier=${frontier.length} stale=${stale.length} neverSeen=${neverSeen.length} scouts=${scouts.length}\n` +
        (scoutLines.length > 0 ? scoutLines.join("\n") : "  (no scouts)")
      );
    });
    return lines.join("\n");
  };
  register("scoutStatus(room?)", "per-colony scouting summary: frontier radius, stale/never-seen counts, and each live scout's current room/target/lastRoom (flags a stranded scout)");

  global.scoutInfo = (room: string): string => {
    const info = Memory.rooms?.[room]?.scouted;
    if (!info) return `${room}: never scouted (no ScoutInfo on record)`;

    const now = Game.time;
    const age = info.tick !== undefined ? now - info.tick : undefined;
    const stale = needsScouting({ room, distance: 0, type: info.type, info }, now);
    const lines = [
      `${room}: type=${info.type} lastSeen=${info.tick ?? "never"}${age !== undefined ? ` (${age} ticks ago, staleAfter=${staleAfter(info.type)})` : ""} ${stale ? "STALE" : "fresh"}`,
      `  owner=${info.owner ?? "-"} hostile=${info.hostile} mineral=${info.mineral ?? "-"}`,
      `  anchor=${info.anchor ? `(${info.anchor.x},${info.anchor.y})` : info.anchorChecked ? "none (checked)" : "not checked"}`,
      `  sources=${info.sources.length}${info.sources.length > 0 ? `: ${info.sources.map(s => s.id).join(", ")}` : ""}`,
      `  potential=${info.potential ? `normal=${info.potential.normal.toFixed(1)} keeper=${info.potential.keeper.toFixed(1)}` : info.potentialChecked ? "checked, 0" : "not checked"}`
    ];
    if (info.lethalAt !== undefined) lines.push(`  lethalAt=${info.lethalAt} (${now - info.lethalAt} ticks ago)`);
    if (info.invaderCore) {
      const core = info.invaderCore;
      lines.push(`  invaderCore: level=${core.level} ticksToDeploy=${core.ticksToDeploy ?? "-"} collapseTicksRemaining=${core.collapseTicksRemaining ?? "-"}`);
    }
    if (info.noPathFrom && Object.keys(info.noPathFrom).length > 0) {
      lines.push(`  noPathFrom: ${Object.entries(info.noPathFrom).map(([h, t]) => `${h}@${t}`).join(", ")}`);
    }
    return lines.join("\n");
  };
  register("scoutInfo(room)", "dump one room's cached ScoutInfo in full: type, last-seen age vs staleAfter, owner/hostile/mineral, anchor, sources, colonize potential, lethal/invader-core/noPathFrom negative caches");

  global.scanMarket = (): string => {
    Memory.market = scanMarketNow();
    const count = Object.keys(Memory.market.prices).length;
    return `market scan complete: ${count} resources priced (tick ${Game.time})`;
  };
  register("scanMarket()", "manually scan Game.market.getHistory() and refresh Memory.market now, instead of waiting for the tier-3 interval");

  global.manufactureCost = (resource: string, includeDecompress?: boolean): string => {
    const prices = Memory.market?.prices ?? {};
    if (!Memory.market) return `no market data yet — run scanMarket() first (falling back to unpriced base resources only)\n${formatManufacturingCost(manufacturingCost(resource, prices, includeDecompress))}`;
    return formatManufacturingCost(manufacturingCost(resource, prices, includeDecompress));
  };
  register(
    "manufactureCost(resource, includeDecompress?)",
    "recursively price a mineral compound or commodity (e.g. \"XGH2O\", \"utrium_bar\") from REACTIONS/COMMODITIES, picking market price vs recipe cost per component at every level; run scanMarket() first for real prices. includeDecompress (default false) also considers decompressing a raw mineral/energy back from its bar/battery — off by default since that needs a factory, which isn't always available"
  );

  global.clearDrainTarget = (room: string): string => {
    if (!Memory.colonies[room]) return `no colony memory for "${room}" yet`;
    execute([{ kind: "clearDrainTarget", room }]);
    return `cleared draining target for "${room}" — Drain operation stops attaching from the next tick`;
  };
  register("clearDrainTarget(room)", "manually stop a colony's active drain (clears ColonyMemory.draining), same effect as removing the drain flag");

  global.removeOperation = (kind: string, room: string, target?: string): string => {
    if (!Memory.colonies[room]) return `no colony memory for "${room}" yet`;
    switch (kind) {
      case "colonize":
        if (!target) return `removeOperation("colonize", room, target) needs a target room`;
        execute([{ kind: "removeColonizeTarget", room, target }]);
        return `removed colonize target "${target}" from "${room}"`;
      case "attack":
        if (!target) return `removeOperation("attack", room, target) needs a target room`;
        execute([{ kind: "removeAttackTarget", room, target }]);
        return `removed attack target "${target}" from "${room}"`;
      case "defend":
        if (!target) return `removeOperation("defend", room, target) needs a target room`;
        execute([{ kind: "removeDefendTarget", room, target }]);
        return `removed defend target "${target}" from "${room}"`;
      case "drain":
        execute([{ kind: "clearDrainTarget", room }]);
        return `cleared draining target for "${room}"`;
      case "parade":
        execute([{ kind: "clearParadeTarget", room }]);
        return `cleared parading target for "${room}"`;
      default:
        return `unknown operation kind "${kind}" — use one of: colonize, attack, defend, drain, parade`;
    }
  };
  register(
    "removeOperation(kind, room, target?)",
    "stop a memory-triggered operation for a colony: colonize/attack/defend need (kind, room, target), drain/parade need only (kind, room)"
  );

  global.help = (): string => COMMANDS.map(([usage, description]) => `${usage} — ${description}`).join("\n");
  register("help()", "list available console commands");
}
