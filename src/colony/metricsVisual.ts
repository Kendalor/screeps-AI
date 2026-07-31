// Renders a ColonyMetrics report into a roomVisual intent. Pure — produces plain VisualOps only;
// execute.ts does the actual drawing.

import type { Intent, VisualOp } from "../intents/types";
import type { ColonyMetrics } from "./metrics";

// Panel geometry, in room-tile coordinates (0..49).
const PANEL_X = 0.5;
const PANEL_TOP = 0.5;
const LINE_H = 0.8; // vertical step between lines
const FONT = 0.6;

const HEADING = "#ffe66d"; // section headings
const DIM = "#aaaaaa"; // labels
const OK = "#8ee06f"; // healthy / met
const WARN = "#ff6b6b"; // understaffed / attention

/** A one-shot line writer that tracks the running y so callers just append. */
function panel(): { line: (text: string, color?: string, indent?: number) => void; ops: VisualOp[] } {
  const ops: VisualOp[] = [];
  let y = PANEL_TOP + LINE_H;
  return {
    ops,
    line(text: string, color = DIM, indent = 0): void {
      ops.push({ op: "text", text, x: PANEL_X + indent, y, color, align: "left", size: FONT });
      y += LINE_H;
    }
  };
}

function fmt(n: number): string {
  // Thousands separators so a six-figure storage reading is readable at a glance.
  return Math.round(n).toLocaleString("en-US");
}

// Compact magnitude for values that get large: 24_000 -> "24k", 1_200_000 -> "1.2m". One decimal only
// when it adds information (24.0k reads as noise, 1.2m does not). Below 1k the raw rounded number.
function kmb(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trim(n / 1e6)}m`;
  if (abs >= 1e3) return `${trim(n / 1e3)}k`;
  return `${Math.round(n)}`;
}

// One decimal, but drop a trailing ".0".
function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Build the drawing ops for one colony's report. Exposed for tests; visualize() wraps it in an intent. */
export function panelOps(m: ColonyMetrics, cpu?: Readonly<Record<string, number>>): VisualOp[] {
  const p = panel();

  p.line(`${m.room}  ·  RCL ${m.controller.level}  ·  tick ${m.tick}`, HEADING);

  // Census: role  current/target. Red when short (understaffed) or over (a surplus the ops no longer want).
  p.line("Census", HEADING);
  if (m.census.length === 0) p.line("(no creeps)", DIM, 0.5);
  for (const row of m.census) {
    const staffed = row.current >= row.desired;
    p.line(`${row.role.padEnd(10)} ${row.current}/${row.desired}`, staffed ? OK : WARN, 0.5);
  }

  // Energy block.
  p.line("Energy", HEADING);
  p.line(`spawn      ${fmt(m.energy.available)}/${fmt(m.energy.capacity)}`, DIM, 0.5);
  p.line(`storage    ${fmt(m.energy.storage)}`, DIM, 0.5);
  p.line(`dropped    ${fmt(m.energy.dropped)}`, DIM, 0.5);
  if (m.energy.remoteEnergy > 0) p.line(`remote     ${fmt(m.energy.remoteEnergy)}`, DIM, 0.5);
  p.line(
    `harvest/t  ${m.energy.harvestPerTick === undefined ? "—" : m.energy.harvestPerTick.toFixed(1)}`,
    DIM,
    0.5
  );

  // Spawn load: living body parts vs. what the whole colony's spawns can sustain (each spawn = 500 parts).
  // A colony-level utilisation, so it stays comparable as spawn count grows over time.
  p.line("Spawns", HEADING);
  p.line(`load       ${m.spawns.parts}/${m.spawns.capacity} parts (${m.spawns.busy}/${m.spawns.total} busy)`, DIM, 0.5);
  p.line(`util       ${(m.spawns.load * 100).toFixed(0)}%`, m.spawns.load >= 1 ? WARN : OK, 0.5);

  // Buildings: built/targeted per type, red while any remain to build.
  p.line("Buildings", HEADING);
  if (m.buildings.length === 0) p.line("(none planned)", DIM, 0.5);
  for (const row of m.buildings) {
    const done = row.built >= row.targeted;
    p.line(`${row.type.padEnd(10)} ${row.built}/${row.targeted}`, done ? OK : WARN, 0.5);
  }

  // Progress: controller + any construction + any repair upkeep. The bracketed figure on the build/repair
  // lines is the energy still to spend: construction is 1 energy per point, repair is REPAIR_POWER (100)
  // hits per energy, so hits/100. The controller reads progress/total directly — its points are 1 energy
  // each, so a separate energy figure would just restate the number.
  p.line("Progress", HEADING);
  p.line(`controller ${kmb(m.controller.progress)}/${kmb(m.controller.progressTotal)}`, DIM, 0.5);
  if (m.construction.remaining > 0) {
    p.line(`building   ${fmt(m.construction.remaining)} left [${fmt(m.construction.remaining)}e]`, DIM, 0.5);
  }
  if (m.construction.remoteRemaining > 0) {
    p.line(
      `remote bld ${fmt(m.construction.remoteRemaining)} left [${fmt(m.construction.remoteRemaining)}e]`,
      DIM,
      0.75
    );
  }
  // Repair upkeep, shown as soon as anything has decayed at all (not only past the repairer's floor).
  // `decay` is the visible total; the WARN colour and the "(Ne to fix)" energy figure track `actionable`
  // — the subset a repairer would actually restore — so a healthy-but-decaying colony reads dim with no
  // energy call-out, and only genuine backlog turns it red. Energy is hits / REPAIR_POWER (100).
  if (m.repair.decay > 0) {
    const actionableEnergy = m.repair.actionable / REPAIR_POWER;
    const suffix = m.repair.actionable > 0 ? ` (${kmb(m.repair.actionable)} to fix [${fmt(actionableEnergy)}e])` : "";
    p.line(`repair     ${kmb(m.repair.decay)} hits${suffix}`, m.repair.actionable > 0 ? WARN : DIM, 0.5);
  }
  // Remote decay: same figures, additive to the home line above, and never actioned by a dispatched
  // repairer today (see ColonyMetrics.repair) — still WARN when past the floor so it isn't missed.
  if (m.repair.remoteDecay > 0) {
    const remoteActionableEnergy = m.repair.remoteActionable / REPAIR_POWER;
    const remoteSuffix =
      m.repair.remoteActionable > 0 ? ` (${kmb(m.repair.remoteActionable)} to fix [${fmt(remoteActionableEnergy)}e])` : "";
    p.line(`remote rep ${kmb(m.repair.remoteDecay)} hits${remoteSuffix}`, m.repair.remoteActionable > 0 ? WARN : DIM, 0.75);
  }

  // Safe mode: highlight when actually active.
  const sm =
    m.safeMode.active > 0
      ? `ACTIVE ${m.safeMode.active}t`
      : `${m.safeMode.count} banked${m.safeMode.available ? "" : " (locked)"}`;
  p.line(`SafeMode   ${sm}`, m.safeMode.active > 0 ? WARN : DIM);

  // Operations owned by this colony.
  p.line("Operations", HEADING);
  for (const op of m.operations) p.line(op, DIM, 0.5);

  // CPU, empire-wide (not per-colony) — shown only when the caller passes last tick's breakdown in,
  // so a colony with no cpu data (e.g. under test) renders identically to before this was added.
  if (cpu) {
    p.line("CPU", HEADING);
    const entries = Object.entries(cpu).filter(([name]) => name !== "total");
    for (const [name, used] of entries.sort(([, a], [, b]) => b - a)) {
      p.line(`${name.padEnd(10)} ${used.toFixed(2)}`, DIM, 0.5);
    }
    if (cpu.total !== undefined) p.line(`total      ${cpu.total.toFixed(2)} / ${Game.cpu.limit}`, OK, 0.5);
  }

  return p.ops;
}

/** The full render: the report's panel as a single roomVisual intent for its room. `cpu` is last
 * tick's Memory.stats.cpu breakdown — empire-wide, so pass it for one colony only (the panel picks). */
export function visualize(m: ColonyMetrics, cpu?: Readonly<Record<string, number>>): Intent {
  return { kind: "roomVisual", room: m.room, ops: panelOps(m, cpu) };
}
