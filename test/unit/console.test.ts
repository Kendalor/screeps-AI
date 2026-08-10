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
    Memory.colonies = { W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], draining: "W5N5" } };
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

describe("console: operationKinds", () => {
  it("lists always-on and conditional operation kinds with their trigger", () => {
    const text = global.operationKinds();
    expect(text).toContain("mining — always");
    expect(text).toContain("drain — ColonyMemory.draining set (drain flag)");
    expect(text).toContain("parade — ColonyMemory.parading set (parade flag)");
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
    expect(text).toContain("help()");
  });

  it("does not duplicate entries across repeated installs", () => {
    installConsoleCommands(); // simulate a second global reset within the same module scope
    const lines = global.help().split("\n");
    const setLogLevelLines = lines.filter(l => l.startsWith("setLogLevel"));
    expect(setLogLevelLines).toHaveLength(1);
  });
});
