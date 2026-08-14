// Root-cause investigation for a live report: a creep stuck for ~300 ticks behind another creep,
// which travelTo's built-in "unstick" mechanism (src/lib/traveler.ts) is supposed to resolve within
// a handful of ticks by switching to ignoreCreeps:false and repathing around the blocker.
//
// This runs the real engine (real PathFinder, real terrain, real creep collision) against a
// hand-written test-only bot (fixtures/traveler-corridor-main.ts), not the production bundle —
// isolating Traveler.travelTo from the rest of the role/interpreter stack.
//
// Two scenarios:
//  - "wide corridor": a blocker with a way around it. The blocked creep should detect stuck,
//    flip ignoreCreeps, and route around within a few ticks.
//  - "one-wide corridor": no way around the blocker at all. This is the shape of the live report —
//    a narrow bunker passage — and is expected to show the creep re-attempting the same blocked move
//    every tick indefinitely, since no path around the blocker exists in the corridor's topology.

import { afterEach, expect, test } from "vitest";
import { TerrainMatrix } from "screeps-server-mockup";
import { BootedColony } from "./harness";
import { buildCorridorFixture } from "./fixtures/build-corridor-fixture.mjs";

const ROOM = "W0N1";

// A 3-wide horizontal corridor along y=24..26, walled everywhere else, with a side pocket at
// x=30 so a blocked creep has somewhere to route around the blocker.
function wideCorridorTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) terrain.set(x, y, "wall");
  }
  for (let x = 20; x <= 35; x++) {
    for (let y = 24; y <= 26; y++) terrain.set(x, y, "plain");
  }
  return terrain;
}

// A strictly 1-wide horizontal corridor along y=25 only — no side pocket, no way around anything.
function oneWideCorridorTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) terrain.set(x, y, "wall");
  }
  for (let x = 20; x <= 35; x++) terrain.set(x, 25, "plain");
  return terrain;
}

// A 1-wide corridor with a single 2-wide passing point at x=27..28 (y=24..26 there only) — enough
// room for exactly one creep to step aside while a queue behind it waits, matching a bunker's usual
// chokepoint shape (one bypass tile per corridor segment, not open ground everywhere).
function chokepointCorridorTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) terrain.set(x, y, "wall");
  }
  for (let x = 15; x <= 40; x++) terrain.set(x, 25, "plain");
  for (let x = 27; x <= 28; x++) {
    terrain.set(x, 24, "plain");
    terrain.set(x, 26, "plain");
  }
  return terrain;
}

// Stopped after each test (not just afterAll) — each test boots its own real child-process pserver,
// and letting them pile up until the file finishes starves later tests of CPU, making 300-tick
// budgets fail even though the behaviour under test is fine (observed: the chokepoint test alone
// resolves in ~20 ticks, but timed out at 300 when three earlier colonies were still running).
let colonies: BootedColony[] = [];

afterEach(() => {
  for (const c of colonies) c.stop();
  colonies = [];
});

test(
  "a blocked creep in a wide corridor routes around the blocker within a few ticks",
  async () => {
    const botCode = await buildCorridorFixture();
    const colony = await BootedColony.boot({
      botCode,
      room: ROOM,
      terrain: wideCorridorTerrain(),
      spawnOnLayout: false,
      spawnX: 20,
      spawnY: 25
    });
    colonies.push(colony);

    // Blocker sits still at (25,25); mover starts at (22,25) and must reach (28,25) — straight through
    // the blocker in the 3-wide corridor, with room to step around it via y=24/26.
    await colony.addCreep("blocker", 25, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.addCreep("mover", 22, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.patchMemory(mem => {
      (mem as Record<string, unknown>).targets = {
        // blocker "travels" to its own tile: range:0 makes travelTo a no-op immediately, so it never moves.
        blocker: { x: 25, y: 25, roomName: ROOM },
        mover: { x: 28, y: 25, roomName: ROOM }
      };
    });

    const arrived = async (): Promise<boolean> => {
      const objs = await colony.roomObjects();
      const mover = objs.find(o => o.type === "creep" && o.name === "mover") as
        | { x: number; y: number }
        | undefined;
      return mover?.x === 28 && mover?.y === 25;
    };

    const reached = await colony.runUntil(arrived, 100);
    expect(reached, "mover never routed around the stationary blocker within 100 ticks").not.toBeNull();
  },
  60_000
);

test(
  "a blocked creep in a one-wide corridor with no detour stays stuck (root cause, not the coin-flip)",
  async () => {
    const botCode = await buildCorridorFixture();
    const colony = await BootedColony.boot({
      botCode,
      room: ROOM,
      terrain: oneWideCorridorTerrain(),
      spawnOnLayout: false,
      spawnX: 20,
      spawnY: 25
    });
    colonies.push(colony);

    await colony.addCreep("blocker", 25, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.addCreep("mover", 22, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.patchMemory(mem => {
      (mem as Record<string, unknown>).targets = {
        blocker: { x: 25, y: 25, roomName: ROOM },
        mover: { x: 28, y: 25, roomName: ROOM }
      };
    });

    await colony.runTicks(300);

    const mem = (await colony.memory()) as {
      log?: Record<string, Array<{ t: number; x: number; y: number; stuck: number }>>;
    };
    const moverLog = mem.log?.mover ?? [];
    const lastEntries = moverLog.slice(-10);
    console.log("mover trajectory (last 10 ticks):", JSON.stringify(lastEntries));

    const objs = await colony.roomObjects();
    const mover = objs.find(o => o.type === "creep" && o.name === "mover") as
      | { x: number; y: number }
      | undefined;

    // The mover advances up to the blocker (x=24, adjacent to the blocker at x=25) and never gets
    // past it — correct behaviour for a genuine topological dead end with no detour in a strict
    // 1-wide corridor. Traveler's stuck-recovery may briefly nudge it one tile back while it repaths
    // around the (impassable) blocker, so the resting position sits in the two tiles right at the
    // chokepoint rather than a single fixed one.
    expect(mover?.x, "mover should never pass the blocker at x=25").toBeLessThan(25);
    expect(mover?.x, "mover should be right at the blocker, not stuck further back").toBeGreaterThanOrEqual(23);
    expect(mover?.y).toBe(25);
  },
  90_000
);

test(
  "two creeps meeting head-on in a wide corridor both resolve within a few ticks, not hundreds",
  async () => {
    const botCode = await buildCorridorFixture();
    const colony = await BootedColony.boot({
      botCode,
      room: ROOM,
      terrain: wideCorridorTerrain(),
      spawnOnLayout: false,
      spawnX: 20,
      spawnY: 25
    });
    colonies.push(colony);

    // Both creeps actively travelTo through each other — unlike the stationary-blocker scenarios
    // above, each one's "blocker" is itself trying to move every tick, which is the shape most likely
    // to reproduce a long-lived livelock rather than a clean single-sided detour.
    await colony.addCreep("east", 22, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.addCreep("west", 33, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.patchMemory(mem => {
      (mem as Record<string, unknown>).targets = {
        east: { x: 33, y: 25, roomName: ROOM },
        west: { x: 22, y: 25, roomName: ROOM }
      };
    });

    const swapped = async (): Promise<boolean> => {
      const objs = await colony.roomObjects();
      const east = objs.find(o => o.type === "creep" && o.name === "east") as
        | { x: number; y: number }
        | undefined;
      const west = objs.find(o => o.type === "creep" && o.name === "west") as
        | { x: number; y: number }
        | undefined;
      return east?.x === 33 && east?.y === 25 && west?.x === 22 && west?.y === 25;
    };

    const reached = await colony.runUntil(swapped, 300);

    const mem = (await colony.memory()) as {
      log?: Record<string, Array<{ t: number; x: number; y: number; stuck: number }>>;
    };
    if (reached === null) {
      console.log("east trajectory (last 15):", JSON.stringify(mem.log?.east?.slice(-15)));
      console.log("west trajectory (last 15):", JSON.stringify(mem.log?.west?.slice(-15)));
    }

    // The real-world report was ~300 ticks stuck; this asserts a much tighter budget so the test fails
    // loudly (rather than technically passing at tick 299) if the same slow-resolution pattern shows up.
    expect(reached, "two creeps passing head-on took far too long to resolve").not.toBeNull();
    expect(reached!, `resolved at tick ${reached}, expected well under 300`).toBeLessThan(50);
  },
  60_000
);

test(
  "a queue of creeps behind two front creeps meeting at a chokepoint resolves without a long livelock",
  async () => {
    // Reproduces the reported "multiple hauler/upgrader in a single queue waiting for the top creep
    // to move, with the top creeps switching positions every tick for 100 ticks": two lines of creeps
    // approaching a chokepoint from opposite ends, each line's front creep meeting the other's front
    // creep right at (or near) the one passing point.
    const botCode = await buildCorridorFixture();
    const colony = await BootedColony.boot({
      botCode,
      room: ROOM,
      terrain: chokepointCorridorTerrain(),
      spawnOnLayout: false,
      spawnX: 15,
      spawnY: 25
    });
    colonies.push(colony);

    // East-bound queue at x=20,21,22 (front, mid, back), heading to x=35.
    // West-bound queue at x=35,34,33 (front, mid, back), heading to x=20.
    const eastQueue = ["e_front", "e_mid", "e_back"];
    const westQueue = ["w_front", "w_mid", "w_back"];
    for (let i = 0; i < eastQueue.length; i++) {
      await colony.addCreep(eastQueue[i], 20 - i, 25, {
        body: [{ type: "move", hits: 50 }],
        hits: 50,
        hitsMax: 50,
        spawning: false,
        fatigue: 0
      });
    }
    for (let i = 0; i < westQueue.length; i++) {
      await colony.addCreep(westQueue[i], 35 + i, 25, {
        body: [{ type: "move", hits: 50 }],
        hits: 50,
        hitsMax: 50,
        spawning: false,
        fatigue: 0
      });
    }
    await colony.patchMemory(mem => {
      const targets: Record<string, { x: number; y: number; roomName: string }> = {};
      for (const name of eastQueue) targets[name] = { x: 35, y: 25, roomName: ROOM };
      for (const name of westQueue) targets[name] = { x: 20, y: 25, roomName: ROOM };
      (mem as Record<string, unknown>).targets = targets;
    });

    const allSwapped = async (): Promise<boolean> => {
      const objs = await colony.roomObjects();
      const xOf = (name: string): number | undefined =>
        (objs.find(o => o.type === "creep" && o.name === name) as { x: number } | undefined)?.x;
      // Everyone made it past the chokepoint onto the far side from where they started.
      return eastQueue.every(n => (xOf(n) ?? 0) >= 33) && westQueue.every(n => (xOf(n) ?? 99) <= 22);
    };

    const reached = await colony.runUntil(allSwapped, 300);
    console.log("CHOKEPOINT resolved at tick:", reached);

    expect(reached, "the two queues never fully passed each other within 300 ticks").not.toBeNull();
  },
  60_000
);

test(
  "two unconditional travelTo calls to the same creep in one tick: the later call always wins",
  async () => {
    // Demonstrates the underlying Traveler behaviour the real fix (src/empire/creeps.ts's
    // coFireBonusStep + interpreter.ts's allowTravel) depends on: travelTo keeps exactly one _trav
    // slot per creep, so whichever call happens last in a tick silently overwrites the earlier call's
    // in-flight destination — there is no "merge" or "queue". This is *why* letting a co-fired bonus
    // step call travelTo at all is unsafe (see the unit-level regression in
    // test/unit/creepDispatch.test.ts's "co-fire never steals movement from the primary step"); this
    // integration test pins the raw mechanism using the fixture's dualTargets path directly, not the
    // production interpreter.
    const botCode = await buildCorridorFixture();
    const colony = await BootedColony.boot({
      botCode,
      room: ROOM,
      terrain: wideCorridorTerrain(),
      spawnOnLayout: false,
      spawnX: 20,
      spawnY: 25
    });
    colonies.push(colony);

    await colony.addCreep("dual", 27, 25, {
      body: [{ type: "move", hits: 50 }],
      hits: 50,
      hitsMax: 50,
      spawning: false,
      fatigue: 0
    });
    await colony.patchMemory(mem => {
      (mem as Record<string, unknown>).dualTargets = {
        dual: [
          { x: 21, y: 25, roomName: ROOM },
          { x: 34, y: 25, roomName: ROOM }
        ]
      };
    });

    const arrivedAtSecond = async (): Promise<boolean> => {
      const objs = await colony.roomObjects();
      const dual = objs.find(o => o.type === "creep" && o.name === "dual") as
        | { x: number; y: number }
        | undefined;
      return dual?.x === 34 && dual?.y === 25;
    };

    const reached = await colony.runUntil(arrivedAtSecond, 60);
    expect(
      reached,
      "the creep should walk straight to the second (later-called) target, never the first"
    ).not.toBeNull();
  },
  60_000
);
