// Renders a ColonyMetrics report into a roomVisual intent: a text panel drawn in the top-left of the
// room. Pure — it produces plain VisualOps and never touches a live RoomVisual (execute.ts does the
// drawing). Kept separate from collection so the two concerns test independently: metrics.ts proves
// the numbers, this proves the layout.

import type { Intent, VisualOp } from "../intents/types";
import type { ColonyMetrics } from "./metrics";

// Panel geometry, in room-tile coordinates (0..49). A half-transparent backdrop keeps the text
// legible over terrain.
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

/** Build the drawing ops for one colony's report. Exposed for tests; visualize() wraps it in an intent. */
export function panelOps(m: ColonyMetrics): VisualOp[] {
  const p = panel();

  p.line(`${m.room}  ·  RCL ${m.controller.level}  ·  tick ${m.tick}`, HEADING);

  // Census: role  current/desired, red when short.
  p.line("Census", HEADING);
  if (m.census.length === 0) p.line("(no creeps)", DIM, 0.5);
  for (const row of m.census) {
    const short = row.current < row.desired;
    p.line(`${row.role.padEnd(10)} ${row.current}/${row.desired}`, short ? WARN : OK, 0.5);
  }

  // Energy block.
  p.line("Energy", HEADING);
  p.line(`spawn      ${fmt(m.energy.available)}/${fmt(m.energy.capacity)}`, DIM, 0.5);
  p.line(`storage    ${fmt(m.energy.storage)}`, DIM, 0.5);
  p.line(`dropped    ${fmt(m.energy.dropped)}`, DIM, 0.5);
  p.line(
    `harvest/t  ${m.energy.harvestPerTick === undefined ? "—" : m.energy.harvestPerTick.toFixed(1)}`,
    DIM,
    0.5
  );

  // Buildings: built/targeted per type, red while any remain to build.
  p.line("Buildings", HEADING);
  if (m.buildings.length === 0) p.line("(none planned)", DIM, 0.5);
  for (const row of m.buildings) {
    const done = row.built >= row.targeted;
    p.line(`${row.type.padEnd(10)} ${row.built}/${row.targeted}`, done ? OK : WARN, 0.5);
  }

  // Progress: controller + any construction.
  p.line("Progress", HEADING);
  p.line(`controller ${fmt(m.controller.progress)}`, DIM, 0.5);
  if (m.construction.remaining > 0) p.line(`building   ${fmt(m.construction.remaining)} left`, DIM, 0.5);

  // Safe mode: highlight when actually active.
  const sm =
    m.safeMode.active > 0
      ? `ACTIVE ${m.safeMode.active}t`
      : `${m.safeMode.count} banked${m.safeMode.available ? "" : " (locked)"}`;
  p.line(`SafeMode   ${sm}`, m.safeMode.active > 0 ? WARN : DIM);

  // Operations owned by this colony.
  p.line("Operations", HEADING);
  for (const op of m.operations) p.line(op, DIM, 0.5);

  return p.ops;
}

/** The full render: the report's panel as a single roomVisual intent for its room. */
export function visualize(m: ColonyMetrics): Intent {
  return { kind: "roomVisual", room: m.room, ops: panelOps(m) };
}
