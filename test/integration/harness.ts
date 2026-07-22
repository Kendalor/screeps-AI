// Integration harness for the screeps-server-mockup: boots the *bundled* bot inside a real private
// server one tick at a time and observes world state (not intent lists, since the `creeps` system
// acts by side effect and returns []) — the API-touching glue can only be verified against a real
// engine, not mocks.
//
// Requires Node 24 + the native mockup build. Runs on demand via `npm run test:integration`.

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

// Builds the shipped bot bundle with rollup and returns dist/main.js as a string for the mockup's
// `main` module. Memoised per process. `BOT_BUNDLE` short-circuits the build to read a prebuilt
// bundle instead — needed because parallel test-file processes all writing dist/main.js would
// race; global-setup.ts builds once up front and sets this env var for every worker.
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

// Lets any number of colonies boot concurrently without a shared "ports in use" list to maintain.
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
  /** Spawn position, used only when `spawnOnLayout` is off or the room admits no anchor. Default (20, 30). */
  spawnX?: number;
  spawnY?: number;
  /**
   * Place the spawn on the bunker layout's own tile rather than `spawnX/spawnY`. Default true —
   * off-layout the colony survives but is quietly mismeasured (the layout's spawn never gets built
   * since CONTROLLER_STRUCTURES.spawn caps at 1, and bunker distances are measured from the wrong tile).
   */
  spawnOnLayout?: boolean;
  username?: string;
  /** Default: an OS-assigned free port, so any number of colonies can boot concurrently. */
  port?: number;
  /** Default: a fresh temp directory per boot (cleaned up by `stop()`), so concurrent servers never collide. */
  serverDir?: string;
  /**
   * Room terrain, laid down before the first tick. Default `bunkerTerrain()`. stubWorld()'s stock
   * rooms cap clearance at 4 vs BUNKER_RADIUS=6, so pickAnchor would return null and nothing
   * downstream of planning would run — pass an explicit matrix only to test that deliberately.
   */
  terrain?: TerrainMatrix;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

// A room the bunker can actually be anchored in. stubWorld()'s stock rooms cap clearance at 4
// vs BUNKER_RADIUS=6, so pickAnchor would return null there and nothing downstream would run.
// The interior wall bands keep clearance >6 near center while forcing the anchor search to
// actually discriminate, rather than every tile on a blank grid qualifying trivially.
export function bunkerTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let i = 0; i < 50; i++) {
    terrain.set(i, 0, "wall");
    terrain.set(i, 49, "wall");
    terrain.set(0, i, "wall");
    terrain.set(49, i, "wall");
  }
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

// Where the bot *will* anchor its bunker, computed before it has run (addBot fixes the spawn
// position before the anchor is cached in Memory). Runs the same pure search resolveAnchor uses,
// so this is the decision, not a guess. Call after setTerrain and before addBot.
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

// Read out of the goal layout rather than restated, so it tracks Base_2.json automatically.
export function layoutSpawnPos(anchor: XY): XY | null {
  const spawn = buildableAtRcl(goalLayout as GoalLayout, 1).find(p => p.type === "spawn");
  if (!spawn) return null;
  const [placed] = stampLayout([spawn], anchor);
  return { x: placed.x, y: placed.y };
}

export class BootedColony {
  // Lives on the colony so sampling across several runUntil legs stays one continuous record.
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
    // A caller-supplied dir is theirs to manage; otherwise each boot gets its own so concurrent
    // servers never collide on the mockup's shared-by-default db.json copy.
    const ownedServerDir = opts.serverDir ? undefined : mkdtempSync(path.join(tmpdir(), "screeps-server-"));
    const dir = opts.serverDir ?? ownedServerDir;
    const server = new ScreepsServer({
      port,
      ...(dir ? { path: dir, logdir: path.join(dir, "logs") } : {})
    });
    await server.world.stubWorld();
    // Before addBot: reshaping terrain after the spawn is placed could bury it in rock.
    await server.world.setTerrain(room, opts.terrain ?? bunkerTerrain());

    // After setTerrain (anchor search reads terrain) and before addBot (spawn position is
    // fixed there and cannot move once the server starts).
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

  // Skips the natural upgrade grind. Call between boot() and the first runTicks/runUntil.
  async setControllerLevel(level: number, progress = 0): Promise<void> {
    const { db } = await this.server.world.load();
    await db["rooms.objects"].update({ room: this.room, type: "controller" }, { $set: { level, progress } });
  }

  // Skips the natural build grind, e.g. addStructure("container", 22, 30, { store: { energy: 0 }, storeCapacity: 2000 }).
  async addStructure(type: string, x: number, y: number, attrs: Record<string, unknown> = {}): Promise<void> {
    await this.server.world.addRoomObject(this.room, type, x, y, attrs);
  }

  // Skips the spawn queue. Has no CreepMemory (role/home) — pair with `patchMemory` or the census
  // won't recognise it; `seedCreeps` does both.
  async addCreep(name: string, x: number, y: number, attrs: Record<string, unknown> = {}): Promise<void> {
    await this.server.world.addRoomObject(this.room, "creep", x, y, {
      name,
      user: this.bot.id,
      notifyWhenAttacked: true,
      ...attrs
    });
  }

  async setStore(id: string, energy: number): Promise<void> {
    const { db } = await this.server.world.load();
    await db["rooms.objects"].update({ _id: id }, { $set: { store: { energy } } });
  }

  // As room.energyCapacityAvailable reports it — the budget planSpawning sizes non-recovery bodies against.
  async energyCapacity(): Promise<number> {
    const level = (await this.controller()).level;
    const spawns = (await this.structures("spawn")).length;
    const extensions = (await this.structures("extension")).length;
    return spawns * SPAWN_ENERGY_CAPACITY + extensions * (EXTENSION_ENERGY_CAPACITY[level] ?? 0);
  }

  // Read-modify-write the bot's Memory (exposed read-only via bot.memory otherwise). Forces a
  // global reset afterwards — without it memory/cache.ts's parse-skip trick reinstates last
  // tick's stale Memory on the next consecutive tick, silently discarding the write.
  async patchMemory(patch: (mem: Record<string, unknown>) => void): Promise<void> {
    const env = this.server.common.storage.env;
    const key = env.keys.MEMORY + this.bot.id;
    const mem = await this.memory();
    patch(mem);
    await env.set(key, JSON.stringify(mem));
    await this.resetGlobal();
  }

  // Forces the bot's next tick into a fresh isolate (bumping the code row's timestamp), clearing
  // module-level state so an externally-written Memory is actually re-read instead of cached.
  async resetGlobal(): Promise<void> {
    const { db } = await this.server.world.load();
    await db["users.code"].update({ user: this.bot.id }, { $set: { timestamp: Date.now() } });
  }

  // Distinct from `structures()` — a site is intent, a structure is a finished build.
  async sites(): Promise<RoomObject[]> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "constructionSite" && o.user === id);
  }

  /** Finished structures of `type` owned by the room (walls/controller excluded). */
  async structures(type: string): Promise<RoomObject[]> {
    return (await this.roomObjects()).filter(o => o.type === type);
  }

  // Null before the bot has run its layout planning. Read from Memory, not inferred from placements.
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

  // Read from Memory since role is the bot's own labelling — the engine only knows "creep".
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

  // Call from an onTick hook: colony.runUntil(pred, 1500, () => colony.sampleEnergy(metrics)).
  async sampleEnergy(metrics: EnergyMetrics): Promise<void> {
    metrics.sample(observeTick((await this.roomObjects()) as RawObj[], this.seenCreeps));
  }

  async sources(): Promise<XY[]> {
    return (await this.roomObjects()).filter(o => o.type === "source").map(o => ({ x: o.x, y: o.y }));
  }

  // 1 = walkable, 0 = wall, indexed [x*50+y] — the form layouts/roads and layouts/stamp expect.
  async terrain(): Promise<Uint8Array> {
    const matrix = await this.server.world.getTerrain(this.room);
    const grid = new Uint8Array(2500);
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) grid[x * 50 + y] = matrix.get(x, y) === "wall" ? 0 : 1;
    }
    return grid;
  }

  // Fields the *layout* planners read (anchor, sources, terrain, controllerLevel, structures);
  // everything else is zeroed. Deliberately not a full buildColonySnapshot, which needs live Game
  // objects that don't exist outside the engine process. anchor() is null before the bot's first tick.
  async layoutSnapshot(): Promise<ColonySnapshot> {
    const objects = await this.roomObjects();
    const controller = objects.find(o => o.type === "controller");
    return {
      name: this.room,
      towers: [],
      hostiles: [],
      woundedFriendlies: [],
      safeModeAvailable: false,
      creeps: [],
      spawns: [],
      energyAvailable: 0,
      energyCapacity: 0,
      sources: (await this.sources()).map((s, i) => ({ ...s, id: `source-${i}` as Id<Source>, openTiles: 8 })),
      drops: [],
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
// Checkpoint ladder
// ---------------------------------------------------------------------------
//
// Scenarios assert sub-milestones with tick windows rather than one final assert, so a failure
// names the first rung missed. A rung is "missed" if its predicate's first-true tick exceeds `by`.

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
