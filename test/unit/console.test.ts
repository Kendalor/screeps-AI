import { beforeEach, describe, expect, it } from "vitest";
import { installConsoleCommands } from "../../src/commands/console";

beforeEach(() => {
  (globalThis as Record<string, unknown>).Memory = {};
  installConsoleCommands();
});

describe("console: setLogLevel", () => {
  it("writes a valid level to Memory.logLevel", () => {
    global.setLogLevel("info");
    expect(Memory.logLevel).toBe("info");
  });

  it("rejects an invalid level without touching memory", () => {
    const result = global.setLogLevel("verbose" as never);
    expect(result).toMatch(/invalid/i);
    expect(Memory.logLevel).toBeUndefined();
  });
});

describe("console: setDebugMetrics", () => {
  it("toggles Memory.debugMetrics on", () => {
    global.setDebugMetrics(true);
    expect(Memory.debugMetrics).toBe(true);
  });

  it("toggles Memory.debugMetrics off", () => {
    global.setDebugMetrics(true);
    global.setDebugMetrics(false);
    expect(Memory.debugMetrics).toBe(false);
  });
});

describe("console: debugCreep / undebugCreep", () => {
  it("adds a creep name to Memory.debugCreeps", () => {
    global.debugCreep("Miner1");
    expect(Memory.debugCreeps).toEqual(["Miner1"]);
  });

  it("does not duplicate an already-enabled creep", () => {
    global.debugCreep("Miner1");
    global.debugCreep("Miner1");
    expect(Memory.debugCreeps).toEqual(["Miner1"]);
  });

  it("removes a creep via undebugCreep", () => {
    global.debugCreep("Miner1");
    global.debugCreep("Miner2");
    global.undebugCreep("Miner1");
    expect(Memory.debugCreeps).toEqual(["Miner2"]);
  });

  it("undebugCreep on a never-enabled creep is a no-op", () => {
    global.undebugCreep("Nobody");
    expect(Memory.debugCreeps).toBeUndefined();
  });
});

describe("console: debugColony / undebugColony", () => {
  it("adds a room name to Memory.debugColonies", () => {
    global.debugColony("W1N1");
    expect(Memory.debugColonies).toEqual(["W1N1"]);
  });

  it("removes a room via undebugColony", () => {
    global.debugColony("W1N1");
    global.undebugColony("W1N1");
    expect(Memory.debugColonies).toEqual([]);
  });
});

describe("console: clearDebug", () => {
  it("clears both debugCreeps and debugColonies", () => {
    global.debugCreep("Miner1");
    global.debugColony("W1N1");
    global.clearDebug();
    expect(Memory.debugCreeps).toEqual([]);
    expect(Memory.debugColonies).toEqual([]);
  });
});

describe("console: resetDebug", () => {
  it("resets logLevel, debugMetrics, and clears traced creeps/colonies in one call", () => {
    global.setLogLevel("info");
    global.setDebugMetrics(true);
    global.debugCreep("Miner1");
    global.debugColony("W1N1");

    global.resetDebug();

    expect(Memory.logLevel).toBe("error");
    expect(Memory.debugMetrics).toBe(false);
    expect(Memory.debugCreeps).toEqual([]);
    expect(Memory.debugColonies).toEqual([]);
  });
});

describe("console: clearDrainTarget", () => {
  it("clears ColonyMemory.draining for the given room", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [], draining: "W5N5" } };
    const result = global.clearDrainTarget("W1N1");
    expect(Memory.colonies.W1N1.draining).toBeUndefined();
    expect(result).toMatch(/W1N1/);
  });

  it("reports when the room has no colony memory yet", () => {
    Memory.colonies = {};
    const result = global.clearDrainTarget("W1N1");
    expect(result).toMatch(/no colony/i);
  });
});

describe("console: removeOperation", () => {
  it("removes a colonize target from the given room", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: ["W2N5"], attacking: [], defending: [] } };
    const result = global.removeOperation("colonize", "W1N1", "W2N5");
    expect(Memory.colonies.W1N1.colonizing).toEqual([]);
    expect(result).toMatch(/W2N5/);
  });

  it("removes an attack target from the given room", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: ["W3N3"], defending: [] } };
    const result = global.removeOperation("attack", "W1N1", "W3N3");
    expect(Memory.colonies.W1N1.attacking).toEqual([]);
    expect(result).toMatch(/W3N3/);
  });

  it("removes a defend target from the given room", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: ["W3N3"] } };
    const result = global.removeOperation("defend", "W1N1", "W3N3");
    expect(Memory.colonies.W1N1.defending).toEqual([]);
    expect(result).toMatch(/W3N3/);
  });

  it("clears a drain target without needing a target argument", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [], draining: "W5N5" } };
    const result = global.removeOperation("drain", "W1N1");
    expect(Memory.colonies.W1N1.draining).toBeUndefined();
    expect(result).toMatch(/W1N1/);
  });

  it("clears a parade target without needing a target argument", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [], parading: { flag: "march", formation: "2x2" } } };
    const result = global.removeOperation("parade", "W1N1");
    expect(Memory.colonies.W1N1.parading).toBeUndefined();
    expect(result).toMatch(/W1N1/);
  });

  it("reports a helpful error for an unknown kind", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    const result = global.removeOperation("bogus", "W1N1");
    expect(result).toMatch(/unknown operation kind/i);
  });

  it("reports when colonize/attack are called without a target", () => {
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };
    expect(global.removeOperation("colonize", "W1N1")).toMatch(/needs a target/i);
    expect(global.removeOperation("attack", "W1N1")).toMatch(/needs a target/i);
  });

  it("reports when the room has no colony memory yet", () => {
    Memory.colonies = {};
    const result = global.removeOperation("colonize", "W1N1", "W2N5");
    expect(result).toMatch(/no colony/i);
  });
});

describe("console: operationKinds", () => {
  it("lists always-on and conditional operation kinds with their trigger", () => {
    const text = global.operationKinds();
    expect(text).toContain("mining — always");
    expect(text).toContain("drain — ColonyMemory.draining set (drain flag)");
    expect(text).toContain("parade — ColonyMemory.parading set (parade flag)");
  });
});

describe("console: scanMarket", () => {
  it("refreshes Memory.stats.market and reports the priced resource count", () => {
    Memory.stats = { version: 1 };
    (globalThis as Record<string, unknown>).Game = {
      time: 12345,
      market: {
        getHistory: () => [
          { resourceType: RESOURCE_ENERGY, date: "2026-08-01", transactions: 1, volume: 100, avgPrice: 1, stddevPrice: 0.1 },
          { resourceType: RESOURCE_OXYGEN, date: "2026-08-01", transactions: 1, volume: 50, avgPrice: 5, stddevPrice: 0.5 }
        ]
      }
    };

    const result = global.scanMarket();

    expect(Memory.stats.market?.tick).toBe(12345);
    expect(Memory.stats.market?.prices[RESOURCE_ENERGY]).toEqual({ avgPrice: 1, stddevPrice: 0.1 });
    expect(result).toMatch(/2 resources priced \(tick 12345\)/);
  });
});

describe("console: help", () => {
  it("lists every registered command", () => {
    const text = global.help();
    expect(text).toContain("setLogLevel");
    expect(text).toContain("setDebugMetrics");
    expect(text).toContain("debugCreep");
    expect(text).toContain("debugColony");
    expect(text).toContain("clearDebug");
    expect(text).toContain("resetDebug");
    expect(text).toContain("removeOperation");
    expect(text).toContain("help()");
  });

  it("does not duplicate entries across repeated installs", () => {
    installConsoleCommands(); // simulate a second global reset within the same module scope
    const lines = global.help().split("\n");
    const setLogLevelLines = lines.filter(l => l.startsWith("setLogLevel"));
    expect(setLogLevelLines).toHaveLength(1);
  });
});
