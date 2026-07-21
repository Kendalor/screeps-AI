// The benchmark recorder is pure file/arithmetic logic, so it belongs in the
// fast suite even though its only consumer is the integration harness. What
// matters is the ring-buffer trim, the "baseline excludes the current run"
// rule, the direction handling, and that a measurement added later starts its
// own history — get those wrong and every future comparison is quietly
// meaningless.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BenchFile,
  formatComparison,
  formatResult,
  isRegression,
  loadBenchmarks,
  MAX_RUNS,
  measurementNames,
  measurementOf,
  median,
  recordBenchmark,
  regressions
} from "../integration/benchmarks";

let file: string;

beforeEach(() => {
  file = path.join(mkdtempSync(path.join(tmpdir(), "bench-")), "benchmarks.json");
});

/** Seed history for the "rcl2" benchmark from per-run measurement objects. */
function seed(runs: Record<string, number | null>[]): void {
  const data: BenchFile = {
    rcl2: runs.map((m, i) => ({ at: `2026-07-0${(i % 9) + 1}T00:00:00.000Z`, ...m }))
  };
  writeFileSync(file, JSON.stringify(data), "utf8");
}

/** Shorthand: seed runs that only carry `ticks`. */
function seedTicks(ticks: (number | null)[]): void {
  seed(ticks.map(t => ({ ticks: t })));
}

describe("median", () => {
  it("averages the middle pair for even-length input", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("takes the middle element for odd-length input", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
});

describe("recordBenchmark: grouping", () => {
  it("records every measurement of a run as one entry", () => {
    recordBenchmark("rcl2", { ticks: 510, energyHarvestedPerTick: 6.04 }, {}, file);

    const runs = loadBenchmarks(file).rcl2;
    expect(runs).toHaveLength(1);
    // The point of the grouped shape: figures observed together stay together.
    expect(runs[0]).toMatchObject({ ticks: 510, energyHarvestedPerTick: 6.04 });
    expect(runs[0].at).toBeTypeOf("string");
  });

  it("returns one comparison per measurement, retrievable by name", () => {
    seed([{ ticks: 500, energyHarvestedPerTick: 6 }]);

    const r = recordBenchmark("rcl2", { ticks: 550, energyHarvestedPerTick: 7 }, {}, file);

    expect(r.comparisons.map(c => c.measurement)).toEqual(["ticks", "energyHarvestedPerTick"]);
    expect(r.get("ticks")?.delta).toBe(50);
    expect(r.get("energyHarvestedPerTick")?.delta).toBe(1);
    expect(r.get("nope")).toBeUndefined();
  });

  it("keeps separate benchmarks under separate keys, sorted and newline-terminated", () => {
    recordBenchmark("rcl2-extensions-built", { ticks: 3600 }, {}, file);
    recordBenchmark("rcl2", { ticks: 510 }, {}, file);

    const raw = readFileSync(file, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(raw))).toEqual(["rcl2", "rcl2-extensions-built"]);
  });

  it("keeps only the last MAX_RUNS runs per benchmark", () => {
    seedTicks(Array.from({ length: MAX_RUNS }, (_, i) => 100 + i));

    recordBenchmark("rcl2", { ticks: 999 }, {}, file);

    const runs = loadBenchmarks(file).rcl2;
    expect(runs).toHaveLength(MAX_RUNS);
    // Oldest dropped, newest appended last.
    expect(measurementOf(runs[0], "ticks")).toBe(101);
    expect(measurementOf(runs.at(-1)!, "ticks")).toBe(999);
  });

  it("does not write when BENCH_NO_WRITE=1 but still compares", () => {
    seedTicks([500]);
    process.env.BENCH_NO_WRITE = "1";
    try {
      const r = recordBenchmark("rcl2", { ticks: 700 }, {}, file);
      expect(r.get("ticks")?.delta).toBe(200);
      expect(loadBenchmarks(file).rcl2).toHaveLength(1);
    } finally {
      delete process.env.BENCH_NO_WRITE;
    }
  });
});

describe("recordBenchmark: baselines", () => {
  it("compares against prior runs only, so a run never flatters itself", () => {
    seedTicks([500, 500, 500]);

    const c = recordBenchmark("rcl2", { ticks: 1000 }, {}, file).get("ticks")!;

    expect(c.baseline).toBe(500);
    expect(c.delta).toBe(500);
    expect(c.ratio).toBe(1);
    expect(c.samples).toBe(3);
  });

  it("ignores runs that did not record the measurement", () => {
    seedTicks([400, null, 600]);

    expect(recordBenchmark("rcl2", { ticks: 500 }, {}, file).get("ticks")?.baseline).toBe(500);
  });

  it("gives a measurement added later its own history, undragged by older runs", () => {
    // Older runs recorded only ticks; harvest is new. Its baseline must come
    // from the one run that has it, not be polluted by the tick figures.
    seed([{ ticks: 500 }, { ticks: 500 }, { ticks: 500, energyHarvestedPerTick: 6 }]);

    const r = recordBenchmark("rcl2", { ticks: 500, energyHarvestedPerTick: 7 }, {}, file);

    expect(r.get("ticks")?.samples).toBe(3);
    expect(r.get("energyHarvestedPerTick")?.samples).toBe(1);
    expect(r.get("energyHarvestedPerTick")?.baseline).toBe(6);
  });

  it("reports no baseline for a measurement never recorded before", () => {
    seedTicks([500]);

    const c = recordBenchmark("rcl2", { energyDecayed: 42 }, {}, file).get("energyDecayed")!;

    expect(c.baseline).toBeNull();
    expect(c.samples).toBe(0);
    expect(isRegression(c)).toBe(false);
  });
});

describe("isRegression", () => {
  it("tolerates run-to-run variance below the threshold", () => {
    seedTicks([500]);
    // +20% on a live server is noise, not a regression.
    expect(isRegression(recordBenchmark("rcl2", { ticks: 600 }, {}, file).get("ticks")!)).toBe(false);
  });

  it("flags a slowdown past the threshold", () => {
    seedTicks([500]);
    expect(isRegression(recordBenchmark("rcl2", { ticks: 700 }, {}, file).get("ticks")!)).toBe(true);
  });

  it("treats a measurement that could not be taken as a regression", () => {
    seedTicks([500]);
    expect(isRegression(recordBenchmark("rcl2", { ticks: null }, {}, file).get("ticks")!)).toBe(true);
  });

  it("never reports a regression on the very first run", () => {
    expect(isRegression(recordBenchmark("rcl2", { ticks: 99_999 }, {}, file).get("ticks")!)).toBe(false);
  });

  it("honours a per-measurement tolerance", () => {
    seedTicks([500]);
    // +10% passes the default 25% gate but not a tight 5% one.
    const r = recordBenchmark("rcl2", { ticks: 550 }, { ticks: { tolerance: 0.05 } }, file);
    expect(isRegression(r.get("ticks")!)).toBe(true);
  });

  describe('direction "higher" (energy rates, where more is better)', () => {
    const spec = { energyHarvestedPerTick: { direction: "higher" as const } };

    it("treats a large drop as a regression", () => {
      seed([{ energyHarvestedPerTick: 10 }]);
      const c = recordBenchmark("rcl2", { energyHarvestedPerTick: 7 }, spec, file).get(
        "energyHarvestedPerTick"
      )!;

      expect(c.regressionRatio).toBeCloseTo(0.3);
      expect(isRegression(c)).toBe(true);
    });

    it("does not flag a rise, however large", () => {
      seed([{ energyHarvestedPerTick: 10 }]);
      const c = recordBenchmark("rcl2", { energyHarvestedPerTick: 25 }, spec, file).get(
        "energyHarvestedPerTick"
      )!;

      expect(isRegression(c)).toBe(false);
    });

    it("is the exact inverse of the default direction for the same numbers", () => {
      seed([{ v: 10 }]);
      const lower = recordBenchmark("rcl2", { v: 7 }, { v: { direction: "lower" } }, file).get("v")!;
      seed([{ v: 10 }]);
      const higher = recordBenchmark("rcl2", { v: 7 }, { v: { direction: "higher" } }, file).get("v")!;

      expect(lower.regressionRatio).toBeCloseTo(-(higher.regressionRatio as number));
      // A 30% drop: an improvement when lower is better, a regression when higher is.
      expect(isRegression(lower)).toBe(false);
      expect(isRegression(higher)).toBe(true);
    });
  });
});

describe("regressions", () => {
  it("names only the measurements that actually regressed", () => {
    seed([{ ticks: 500, energyHarvestedPerTick: 10, energyDecayed: 100 }]);

    const r = recordBenchmark(
      "rcl2",
      { ticks: 505, energyHarvestedPerTick: 5, energyDecayed: 400 },
      { energyHarvestedPerTick: { direction: "higher" } },
      file
    );

    // ticks barely moved; harvest halved; decay quadrupled.
    expect(regressions(r).map(c => c.measurement)).toEqual(["energyHarvestedPerTick", "energyDecayed"]);
  });

  it("is empty when every measurement holds", () => {
    seed([{ ticks: 500, energyDecayed: 100 }]);
    expect(regressions(recordBenchmark("rcl2", { ticks: 510, energyDecayed: 90 }, {}, file))).toEqual([]);
  });
});

describe("measurementNames", () => {
  it("collects names across runs in first-seen order, ignoring bookkeeping keys", () => {
    const runs = [
      { at: "t1", commit: "abc", ticks: 1 },
      { at: "t2", commit: "def", ticks: 2, energyDecayed: 3 }
    ];

    expect(measurementNames(runs)).toEqual(["ticks", "energyDecayed"]);
  });
});

describe("formatComparison", () => {
  it("reports value, baseline, sample count and the verdict", () => {
    seedTicks([500, 500]);
    const out = formatComparison(recordBenchmark("rcl2", { ticks: 700 }, {}, file).get("ticks")!);

    expect(out).toContain("700 ticks");
    expect(out).toContain("baseline 500");
    expect(out).toContain("n=2");
    expect(out).toContain("REGRESSION");
  });

  it("labels a small slowdown as noise, matching the pass/fail verdict", () => {
    seedTicks([500]);
    const out = formatComparison(recordBenchmark("rcl2", { ticks: 520 }, {}, file).get("ticks")!);

    expect(out).toContain("within noise");
    expect(out).not.toContain("REGRESSION");
  });

  it("labels a speedup as an improvement", () => {
    seedTicks([500]);
    expect(formatComparison(recordBenchmark("rcl2", { ticks: 400 }, {}, file).get("ticks")!)).toContain(
      "improvement"
    );
  });

  it("labels a rising rate as an improvement when higher is better", () => {
    seed([{ h: 6 }]);
    const out = formatComparison(
      recordBenchmark("rcl2", { h: 9 }, { h: { direction: "higher", unit: "energy/tick" } }, file).get("h")!
    );

    expect(out).toContain("9 energy/tick");
    expect(out).toContain("higher better");
    expect(out).toContain("improvement");
    expect(out).not.toContain("REGRESSION");
  });

  it("shows the measurement's own unit and rounds fractional values", () => {
    const out = formatComparison(
      recordBenchmark("rcl2", { h: 6.6666 }, { h: { unit: "energy/tick" } }, file).get("h")!
    );

    expect(out).toContain("6.67 energy/tick");
  });

  it("says so plainly when there is no history to compare against", () => {
    expect(formatComparison(recordBenchmark("rcl2", { ticks: 700 }, {}, file).get("ticks")!)).toContain(
      "no baseline yet"
    );
  });
});

describe("formatResult", () => {
  it("lists every measurement and tabulates prior runs on one line each", () => {
    seed([{ ticks: 500, energyDecayed: 100 }]);

    const out = formatResult(recordBenchmark("rcl2", { ticks: 520, energyDecayed: 90 }, {}, file));

    expect(out).toContain("benchmark rcl2:");
    expect(out).toContain("ticks: 520 ticks");
    expect(out).toContain("energyDecayed: 90");
    // History renders each prior run as one line carrying all its measurements.
    expect(out).toContain("history (oldest first, 1 run(s)):");
    expect(out).toContain("ticks=500 energyDecayed=100");
  });

  it("omits the history block on a first run", () => {
    expect(formatResult(recordBenchmark("rcl2", { ticks: 500 }, {}, file))).not.toContain("history");
  });
});
