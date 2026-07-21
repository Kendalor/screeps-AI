// Integration harness for the screeps-server-mockup (docs/rewrite-skeleton.md §8).
//
// Unit tests verify the pure planner cores against plain snapshots. The
// API-touching glue (resolveTarget candidate fetch, runStep dispatch, snapshot
// builders) can only be verified against a real engine — mocking it would only
// test the mocks. This harness boots the *bundled* bot inside a real private
// server one tick at a time and observes world state (not intent lists — the
// `creeps` system acts by side effect and returns []), so milestones assert on
// what actually happened in the world.
//
// Requires Node 24 + the native mockup build (see the screeps-mockup-install
// memory). Runs on demand via `npm run test:integration`, never per-commit.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { ScreepsServer, TerrainMatrix } from "screeps-server-mockup";
import { EXTENSION_ENERGY_CAPACITY, SPAWN_ENERGY_CAPACITY } from "@screeps/common/lib/constants";
import goalLayout from "../../src/layouts/Base_2.json";
import { buildableAtRcl } from "../../src/layouts/goal";
import { findAnchorCandidates, pickAnchor, stampLayout } from "../../src/layouts/stamp";
import type { GoalLayout } from "../../src/layouts/sync";
import type { XY } from "../../src/lib/geometry";
import type { ColonySnapshot } from "../../src/snapshot/types";
import { EnergyMetrics, observeTick, type RawObj } from "./energyMetrics";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Bot bundle
// ---------------------------------------------------------------------------

let cachedBundle: string | undefined;

/**
 * Build the shipped bot bundle with rollup (no DEST/LOCAL env → compile only,
 * no upload, no copy to the live client) and return `dist/main.js` as a string
 * ready to hand to the mockup as the `main` module. Memoised per process so a
 * file with several scenarios only pays the ~1s build once. Runs under the
 * same Node that runs the tests via `process.execPath`.
 *
 * `BOT_BUNDLE` short-circuits the build and reads a prebuilt bundle from that
 * path instead. This is what makes running several test files at once safe:
 * rollup writes to a single shared `dist/main.js`, so several *processes*
 * building at once would race — one truncates the file another is reading,
 * and that worker dies on boot. With `fileParallelism` on, every test file
 * gets its own process (see vitest.integration.config.ts / vitest.benchmark
 * .config.ts, `pool: "forks"`), so both configs set BOT_BUNDLE via a
 * `globalSetup` that builds once up front (test/integration/global-setup.ts).
 * scripts/bench-parallel.mjs does the same for its own multi-process case.
 */
export function bundleBot(): string {
  if (cachedBundle) return cachedBundle;
  const prebuilt = process.env.BOT_BUNDLE;
  if (prebuilt) {
    cachedBundle = readFileSync(prebuilt, "utf8");
    return cachedBundle;
  }
  const rollupBin = path.join(REPO_ROOT, "node_modules", "rollup", "dist", "bin", "rollup");
  execFileSync(process.execPath, [rollupBin, "-c"], { cwd: REPO_ROOT, stdio: "ignore" });
  cachedBundle = readFileSync(path.join(REPO_ROOT, "dist", "main.js"), "utf8");
  return cachedBundle;
}

/**
 * An OS-assigned free TCP port, for `boot()` to bind the mockup's storage to
 * when the caller has not pinned one. Letting the OS pick — rather than a
 * hardcoded number per test file — is what lets any number of colonies boot at
 * once, in one process or across several, with no shared list of "ports in
 * use" to keep in sync by hand.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("could not determine a free port"));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// World observation types
// ---------------------------------------------------------------------------

/** Raw room object as stored in the mockup db (loosely typed — engine schema). */
export interface RoomObject {
  type: string;
  x: number;
  y: number;
  user?: string;
  level?: number;
  progress?: number;
  progressTotal?: number;
  store?: Record<string, number>;
  spawning?: unknown;
  [k: string]: unknown;
}

export interface ControllerState {
  level: number;
  progress: number;
}

// ---------------------------------------------------------------------------
// Booted colony
// ---------------------------------------------------------------------------

export interface BootOptions {
  /** Bundled bot code (from bundleBot()). */
  botCode: string;
  /** Owned room. Must be one of stubWorld()'s 9 rooms. Default "W0N1". */
  room?: string;
  /**
   * Spawn position. Only consulted when `spawnOnLayout` is switched off, or in
   * a room that admits no anchor; otherwise the layout decides. Default
   * (20, 30) — a plain tile in the stub rooms.
   */
  spawnX?: number;
  spawnY?: number;
  /**
   * Place the spawn on the tile the bunker layout wants it on, rather than at
   * `spawnX/spawnY`. Default true — the bunker is the only layout the bot has,
   * so a spawn anywhere else is a room the bot was never written for.
   *
   * Off-layout, the colony survives but is quietly mismeasured:
   * `CONTROLLER_STRUCTURES.spawn` is 1 until RCL7, so it simply never builds
   * the layout's spawn, and every distance the bunker is designed around
   * (filler round trips, the spawn's place in the extension blob) is measured
   * from the wrong tile. The RCL3 benchmark ran ~20% slow this way.
   *
   * Resolved via `predictAnchor` + `layoutSpawnPos`, so the spawn lands exactly
   * where the bot would have put it. Falls back to `spawnX/spawnY` when the
   * room admits no anchor — with `terrain` defaulting to `bunkerTerrain()` that
   * only happens if a caller passes terrain with no 13x13 pocket.
   */
  spawnOnLayout?: boolean;
  username?: string;
  /**
   * Storage port. Default: an OS-assigned free port, so any number of colonies
   * can boot concurrently (across files or within one) without their storage
   * ever colliding. Pass an explicit port only when something outside this
   * process needs to find it at a known address.
   */
  port?: number;
  /**
   * Server working directory — where the mockup copies `db.json` and writes
   * logs. Default: a fresh, uniquely-named temp directory per boot (cleaned up
   * by `stop()`), so concurrent servers never share one and overwrite each
   * other's database. Pass an explicit directory only when the caller manages
   * its own cleanup (see scripts/bench-parallel.mjs).
   */
  serverDir?: string;
  /**
   * Room terrain, laid down before the first tick. Default `bunkerTerrain()` —
   * every scenario gets the same anchorable room, because the bunker is the
   * only layout the bot has and a room it cannot anchor in is not a room the
   * bot is written for.
   *
   * `stubWorld()`'s stock rooms are the alternative and a poor default: their
   * clearance tops out at 4 against BUNKER_RADIUS=6, so `pickAnchor` returns
   * null, no layout is ever stamped, and anything downstream of planning
   * silently does nothing. Pass an explicit matrix only to test that behaviour
   * deliberately.
   */
  terrain?: TerrainMatrix;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * A room the bunker can actually be anchored in.
 *
 * `stubWorld()`'s rooms are rugged mazes whose maximum distance-to-wall
 * clearance is 4, but `BUNKER_RADIUS` is 6 — the layout needs a 13x13 open
 * pocket. In a stub room `pickAnchor` therefore (correctly) returns null,
 * no anchor is ever cached, and `planBuilding` skips the colony entirely, so
 * nothing downstream of layout placement can be exercised at all.
 *
 * This lays down an open room with a wall border and two interior wall bands
 * well clear of the centre. The bands matter: on a wholly blank grid every
 * interior tile qualifies and the anchor search would be a formality. Here it
 * has to discriminate, while the centre still offers clearance well above 6.
 */
export function bunkerTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  // Room border — the engine treats edge tiles as unbuildable anyway, and a
  // solid rim keeps the distance transform's edge handling honest.
  for (let i = 0; i < 50; i++) {
    terrain.set(i, 0, "wall");
    terrain.set(i, 49, "wall");
    terrain.set(0, i, "wall");
    terrain.set(49, i, "wall");
  }
  // Interior obstacles, kept >6 tiles from the centre so they shape the search
  // without shrinking the bunker pocket below its required radius.
  for (let y = 3; y < 16; y++) {
    terrain.set(6, y, "wall");
    terrain.set(7, y, "wall");
  }
  for (let x = 34; x < 46; x++) {
    terrain.set(x, 40, "wall");
    terrain.set(x, 41, "wall");
  }
  return terrain;
}

// ---------------------------------------------------------------------------
// Predicting the bot's anchor before the bot exists
// ---------------------------------------------------------------------------

/**
 * Where the bot *will* anchor its bunker in `room`, computed before it has run.
 *
 * `addBot` fixes the spawn's position before the server ever starts, but the
 * anchor is the bot's own decision and is not cached in Memory until it has
 * ticked — so a scenario choosing a spawn position has nothing to aim at yet.
 * This closes that gap by running the bot's own search (`findAnchorCandidates`
 * + `pickAnchor`, both pure and fixture-only by design) over the room as it
 * stands, which is exactly what `resolveAnchor` in snapshot/colony.ts will do
 * on the first tick. Same terrain, same controller, same sources, same
 * functions — so the prediction is the decision, not a guess that could drift.
 *
 * Call *after* `setTerrain` and before `addBot`: the search reads terrain, so
 * predicting against the stub terrain and then reshaping it would invalidate
 * the answer.
 */
export async function predictAnchor(server: ScreepsServer, room: string): Promise<XY | null> {
  const matrix = await server.world.getTerrain(room);
  const grid = new Uint8Array(2500);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) grid[x * 50 + y] = matrix.get(x, y) === "wall" ? 0 : 1;
  }

  const objects = (await server.world.roomObjects(room)) as RoomObject[];
  const controller = objects.find(o => o.type === "controller");
  if (!controller) return null;

  return pickAnchor(findAnchorCandidates(grid), {
    controller: { x: controller.x, y: controller.y },
    sources: objects.filter(o => o.type === "source").map(s => ({ x: s.x, y: s.y }))
  });
}

/**
 * The tile the goal layout puts the colony's first spawn on, given `anchor`.
 *
 * Read out of the goal layout rather than restated, so it tracks Base_2.json:
 * the spawn the bot would build first is the lowest-`order` spawn placement,
 * stamped onto the anchor. `buildableAtRcl` at RCL1 applies the same
 * CONTROLLER_STRUCTURES cap the colony lives under, so this is the one spawn
 * slot it is permitted, not merely the first of three in the file.
 */
export function layoutSpawnPos(anchor: XY): XY | null {
  const spawn = buildableAtRcl(goalLayout as GoalLayout, 1).find(p => p.type === "spawn");
  if (!spawn) return null;
  const [placed] = stampLayout([spawn], anchor);
  return { x: placed.x, y: placed.y };
}

export class BootedColony {
  /**
   * Creep ids already charged to the energy accounting. Lives on the colony so
   * sampling across several runUntil legs stays one continuous record.
   */
  private readonly seenCreeps = new Set<string>();

  private constructor(
    readonly server: ScreepsServer,
    readonly bot: Awaited<ReturnType<ScreepsServer["world"]["addBot"]>>,
    readonly room: string,
    /** Set when `boot()` created the server dir itself, so `stop()` removes it. */
    private readonly ownedServerDir?: string
  ) {}

  static async boot(opts: BootOptions): Promise<BootedColony> {
    const room = opts.room ?? "W0N1";
    const port = opts.port ?? (await getFreePort());
    // A caller-supplied dir is theirs to manage (see scripts/bench-parallel.mjs,
    // which shares one across a worker's whole run and cleans it up itself);
    // otherwise each boot gets its own, so concurrent servers never collide on
    // the mockup's shared-by-default `db.json` copy.
    const ownedServerDir = opts.serverDir ? undefined : mkdtempSync(path.join(tmpdir(), "screeps-server-"));
    const dir = opts.serverDir ?? ownedServerDir;
    const server = new ScreepsServer({
      port,
      ...(dir ? { path: dir, logdir: path.join(dir, "logs") } : {})
    });
    await server.world.stubWorld();
    // Before addBot: the spawn is placed into the room as it then stands, so
    // reshaping terrain afterwards could bury it in rock.
    await server.world.setTerrain(room, opts.terrain ?? bunkerTerrain());

    // After setTerrain (the anchor search reads terrain) and before addBot (the
    // spawn position is fixed there and cannot be moved once the server starts).
    let spawn: XY = { x: opts.spawnX ?? 20, y: opts.spawnY ?? 30 };
    if (opts.spawnOnLayout ?? true) {
      const anchor = await predictAnchor(server, room);
      const onLayout = anchor ? layoutSpawnPos(anchor) : null;
      if (onLayout) spawn = onLayout;
    }

    const bot = await server.world.addBot({
      username: opts.username ?? "kendalor",
      room,
      x: spawn.x,
      y: spawn.y,
      modules: { main: opts.botCode }
    });
    await server.start();
    return new BootedColony(server, bot, room, ownedServerDir);
  }

  /** All room objects in the colony room (walls excluded — engine object rows). */
  async roomObjects(): Promise<RoomObject[]> {
    return (await this.server.world.roomObjects(this.room)) as RoomObject[];
  }

  async controller(): Promise<ControllerState> {
    const c = (await this.roomObjects()).find(o => o.type === "controller");
    return { level: c?.level ?? 0, progress: c?.progress ?? 0 };
  }

  /**
   * Inject a controller level (and optional progress) directly into the
   * mockup DB, skipping the natural upgrade grind. Call between `boot()` and
   * the first `runTicks`/`runUntil` to start a scenario at a given RCL.
   */
  async setControllerLevel(level: number, progress = 0): Promise<void> {
    const { db } = await this.server.world.load();
    await db["rooms.objects"].update({ room: this.room, type: "controller" }, { $set: { level, progress } });
  }

  /**
   * Inject a structure (or construction site) directly into the mockup DB,
   * skipping the natural build grind. Call between `boot()` and the first
   * `runTicks`/`runUntil` to place structures the bot would otherwise build
   * itself, e.g. `addStructure("container", 22, 30, { store: { energy: 0 },
   * storeCapacity: 2000 })`.
   */
  async addStructure(type: string, x: number, y: number, attrs: Record<string, unknown> = {}): Promise<void> {
    await this.server.world.addRoomObject(this.room, type, x, y, attrs);
  }

  /**
   * Inject a living creep directly into the mockup DB, skipping the spawn
   * queue. `attrs` carries the engine's creep fields (body, store, ageTime,
   * `spawning: false`, ...) — see test/integration/seed.ts, which builds them
   * from the bot's own body formulas.
   *
   * The creep is owned by the bot but has no CreepMemory: role and home are the
   * bot's labelling, not the engine's, so pair this with `patchMemory` or the
   * census will not recognise it. `seedCreeps` does both.
   */
  async addCreep(name: string, x: number, y: number, attrs: Record<string, unknown> = {}): Promise<void> {
    await this.server.world.addRoomObject(this.room, "creep", x, y, {
      name,
      user: this.bot.id,
      notifyWhenAttacked: true,
      ...attrs
    });
  }

  /**
   * Set the energy in one room object (by db id). Used to stock spawns,
   * extensions and containers when seeding a mid-game state.
   */
  async setStore(id: string, energy: number): Promise<void> {
    const { db } = await this.server.world.load();
    await db["rooms.objects"].update({ _id: id }, { $set: { store: { energy } } });
  }

  /**
   * The room's spawn+extension energy capacity, as `room.energyCapacityAvailable`
   * reports it — the budget `planSpawning` sizes non-recovery bodies against.
   */
  async energyCapacity(): Promise<number> {
    const level = (await this.controller()).level;
    const spawns = (await this.structures("spawn")).length;
    const extensions = (await this.structures("extension")).length;
    return spawns * SPAWN_ENERGY_CAPACITY + extensions * (EXTENSION_ENERGY_CAPACITY[level] ?? 0);
  }

  /**
   * Read-modify-write the bot's Memory in the server's env store.
   *
   * The mockup exposes Memory read-only (`bot.memory`), but seeding a workforce
   * requires writing CreepMemory the bot will then read as its own. Patching
   * rather than replacing keeps whatever the bot has already recorded — the
   * cached anchor above all, which seeding depends on.
   *
   * Forces a global reset afterwards, without which the write does not survive
   * contact with the bot: `memory/cache.ts` reinstates last tick's parsed Memory
   * object whenever it runs on a consecutive tick (the RawMemory parse-skip
   * trick), which discards anything written to storage between two ticks. The
   * seeded entries then reappear as `{}` — the engine's `creep.memory` getter
   * creating fresh ones for names the stale object lacks — and every seeded
   * creep sits inert forever with no role. See `resetGlobal`.
   */
  async patchMemory(patch: (mem: Record<string, unknown>) => void): Promise<void> {
    const env = this.server.common.storage.env;
    const key = env.keys.MEMORY + this.bot.id;
    const mem = await this.memory();
    patch(mem);
    await env.set(key, JSON.stringify(mem));
    await this.resetGlobal();
  }

  /**
   * Force the bot's next tick to run in a fresh isolate — a "global reset", the
   * same event a real server produces when it rotates a runtime.
   *
   * Done by bumping the code row's timestamp: the runtime rebuilds its cached
   * globals when `userCodeTimestamp` changes. That clears the module-level state
   * the bot carries across ticks, which is what makes an externally-written
   * Memory visible: `loadMemory` only re-reads storage when it is *not* running
   * on a tick consecutive to the last one it saw, and a fresh global has no last
   * tick to be consecutive to.
   */
  async resetGlobal(): Promise<void> {
    const { db } = await this.server.world.load();
    await db["users.code"].update({ user: this.bot.id }, { $set: { timestamp: Date.now() } });
  }

  /**
   * Construction sites the bot has placed itself. Distinct from `structures()`
   * — a site is intent, a structure is a finished build.
   */
  async sites(): Promise<RoomObject[]> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "constructionSite" && o.user === id);
  }

  /** Finished structures of `type` owned by the room (walls/controller excluded). */
  async structures(type: string): Promise<RoomObject[]> {
    return (await this.roomObjects()).filter(o => o.type === type);
  }

  /**
   * The bunker anchor the bot computed and cached in Memory, or null before it
   * has run its layout planning. Read from Memory rather than inferred from
   * placements — this is the planner's own recorded decision.
   */
  async anchor(): Promise<{ x: number; y: number } | null> {
    const mem = (await this.memory()) as {
      colonies?: Record<string, { anchor?: { x: number; y: number } }>;
    };
    return mem.colonies?.[this.room]?.anchor ?? null;
  }

  /** Living creeps owned by the bot (includes still-spawning ones). */
  async creepCount(): Promise<number> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "creep" && o.user === id).length;
  }

  /**
   * Roles of the creeps the bot currently has in Memory. Read from Memory
   * rather than the world because role is the bot's own labelling — the engine
   * only knows "creep". Use `hasRole` for the common membership check.
   *
   * Genuinely "alive" since the tick loop reaps dead creeps' Memory (#24);
   * before that fix this over-reported as "every role ever spawned".
   */
  async rolesAlive(): Promise<string[]> {
    const mem = (await this.memory()) as { creeps?: Record<string, { role?: string }> };
    return Object.values(mem.creeps ?? {})
      .map(c => c.role)
      .filter((r): r is string => r !== undefined);
  }

  async hasRole(role: string): Promise<boolean> {
    return (await this.rolesAlive()).includes(role);
  }

  /** Total energy sitting in structures of `type` (containers, storage, ...). */
  async energyIn(type: string): Promise<number> {
    return (await this.structures(type)).reduce(
      (sum, s) => sum + ((s.store?.energy as number | undefined) ?? 0),
      0
    );
  }

  /**
   * Fold the current tick's world state into `metrics`. Call from an `onTick`
   * hook so a scenario accumulates energy accounting as it runs:
   *
   *   const metrics = new EnergyMetrics();
   *   await colony.runUntil(pred, 1500, () => colony.sampleEnergy(metrics));
   *
   * The `seenCreeps` set that attributes each body cost exactly once lives on
   * the colony, so repeated calls across several runUntil legs keep one
   * continuous accounting rather than double-counting creeps already alive.
   */
  async sampleEnergy(metrics: EnergyMetrics): Promise<void> {
    metrics.sample(observeTick((await this.roomObjects()) as RawObj[], this.seenCreeps));
  }

  /**
   * The room's sources, as the planner sees them.
   */
  async sources(): Promise<XY[]> {
    return (await this.roomObjects()).filter(o => o.type === "source").map(o => ({ x: o.x, y: o.y }));
  }

  /**
   * The room's walkability grid in the form `layouts/roads` and `layouts/stamp`
   * expect: 1 = walkable, 0 = wall, indexed `[x*50+y]`. Read from the mockup's
   * own terrain string rather than reconstructed from the TerrainMatrix passed
   * to `boot()`, so it reflects the room the bot is actually planning in.
   */
  async terrain(): Promise<Uint8Array> {
    const matrix = await this.server.world.getTerrain(this.room);
    const grid = new Uint8Array(2500);
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) grid[x * 50 + y] = matrix.get(x, y) === "wall" ? 0 : 1;
    }
    return grid;
  }

  /**
   * A snapshot of this room carrying the fields the *layout* planners read:
   * anchor, sources, terrain, controllerLevel and the built structures. Every
   * other field is filled with an empty/zero value — this is deliberately not a
   * full `buildColonySnapshot`, which needs live `Game` objects that do not
   * exist outside the engine process.
   *
   * The point is that a scenario can ask the bot's own `wantedStructures` what
   * the colony intends to build at a given RCL, instead of restating the layout
   * in the test. The anchor comes from the bot's cached decision in Memory, so
   * it must have run at least one tick first — `anchor()` returns null before
   * then and `wantedStructures` yields nothing.
   */
  async layoutSnapshot(): Promise<ColonySnapshot> {
    const objects = await this.roomObjects();
    const controller = objects.find(o => o.type === "controller");
    return {
      name: this.room,
      towers: [],
      hostiles: [],
      woundedFriendlies: [],
      safeModeAvailable: false,
      census: {},
      spawns: [],
      energyAvailable: 0,
      energyCapacity: 0,
      sources: (await this.sources()).map((s, i) => ({ ...s, id: `source-${i}` as Id<Source> })),
      terrain: await this.terrain(),
      controllerLevel: controller?.level ?? 0,
      controllerProgress: controller?.progress ?? 0,
      storageEnergy: 0,
      containers: [],
      anchor: await this.anchor(),
      structures: objects
        .filter(o => o.type !== "controller" && o.type !== "source" && o.type !== "mineral" && o.type !== "creep")
        .map(o => ({ x: o.x, y: o.y, type: o.type as BuildableStructureConstant })),
      sites: [],
      constructionProgress: 0
    };
  }

  /** Parsed bot Memory (or {} before the first tick writes it). */
  async memory(): Promise<Record<string, unknown>> {
    const raw = await this.bot.memory;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  /**
   * Advance `n` ticks, invoking `onTick(tick)` after each so scenarios can
   * sample gauges / evaluate checkpoints. Returns the final game tick count.
   */
  async runTicks(n: number, onTick?: (tick: number) => void | Promise<void>): Promise<number> {
    let tick = 0;
    for (let i = 0; i < n; i++) {
      await this.server.tick();
      tick = await this.server.world.gameTime;
      if (onTick) await onTick(tick);
    }
    return tick;
  }

  /**
   * Tick until `pred` is satisfied or `maxTicks` elapse. `onTick` still runs
   * every tick (for telemetry sampling). Resolves with the tick it was reached
   * on, or null if the budget ran out.
   */
  async runUntil(
    pred: () => boolean | Promise<boolean>,
    maxTicks: number,
    onTick?: (tick: number) => void | Promise<void>
  ): Promise<number | null> {
    for (let i = 0; i < maxTicks; i++) {
      await this.server.tick();
      const tick = await this.server.world.gameTime;
      if (onTick) await onTick(tick);
      if (await pred()) return tick;
    }
    return null;
  }

  /** Kill the server child processes. Call in afterAll. */
  stop(): void {
    this.server.stop();
    if (this.ownedServerDir) rmSync(this.ownedServerDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Checkpoint ladder (docs/rewrite-skeleton.md §8)
// ---------------------------------------------------------------------------
//
// Scenarios assert sub-milestones with tick windows rather than one final
// assert, so a failure names the first rung missed and the phase is known
// before reading any data. Rungs are checked in order every tick; the first
// tick each predicate holds is recorded, and a rung is "missed" if that tick
// exceeds its `by` budget (or it never held).

export interface Rung {
  name: string;
  /** Latest tick by which this sub-milestone must hold. */
  by: number;
  reached?: number;
}

export class CheckpointLadder {
  constructor(private readonly rungs: Rung[]) {}

  /** Record any newly-satisfied rungs at the current tick. */
  async sample(tick: number, holds: (name: string) => boolean | Promise<boolean>): Promise<void> {
    for (const r of this.rungs) {
      if (r.reached === undefined && (await holds(r.name))) r.reached = tick;
    }
  }

  /** The first rung not reached within its budget, or null if all passed. */
  firstMissed(): Rung | null {
    return this.rungs.find(r => r.reached === undefined || r.reached > r.by) ?? null;
  }

  report(): string {
    return this.rungs
      .map(r => {
        const status =
          r.reached === undefined ? "MISSED" : r.reached > r.by ? `LATE@${r.reached}` : `ok@${r.reached}`;
        return `  ${r.name} (by ${r.by}): ${status}`;
      })
      .join("\n");
  }
}
