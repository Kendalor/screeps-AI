// Role table: body calculator + behavior per role (docs/rewrite-skeleton.md §5).
// Adding a role is adding a row here — not five files and two registries.

import type { RoleName } from "../memory/schema";
import type { BodyContext, RoleDef } from "./types";

// Ported from Allrounder.getBody: 200-energy [WORK,CARRY,MOVE] sets, clamped
// to [300, 1200] energy and at most 4 sets; a spare >100 energy buys a
// leading MOVE,CARRY pair.
function bootstrapBody(energy: number): BodyPartConstant[] {
  const energyCap = Math.min(Math.max(300, energy), 1200);
  const fullSets = Math.min(Math.max(1, Math.floor(energyCap / 200)), 4);
  let parts: BodyPartConstant[] = [];
  if (energyCap - fullSets * 200 > 100) {
    parts = [MOVE, CARRY];
  }
  for (let i = 0; i < fullSets; i++) {
    parts = parts.concat([WORK, CARRY, MOVE]);
  }
  return parts;
}

// Ported from Upgrader.getBody: a WORK/CARRY/MOVE base, clamped to a
// 300-energy floor, plus WORK,WORK,MOVE sets (heavy WORK, standard 2:1
// move ratio) up to 15 sets (the 50-body-part cap).
function upgraderBody(energy: number): BodyPartConstant[] {
  const energyCap = Math.min(Math.max(300, energy), 4050);
  const fullSets = Math.min(15, Math.max(0, Math.floor((energyCap - 300) / 250)));
  let parts: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE];
  for (let i = 0; i < fullSets; i++) {
    parts = parts.concat([WORK, WORK, MOVE]);
  }
  return parts;
}

const SOURCE_SATURATING_WORK = 5; // 5 WORK * 2 energy/tick == a source's 10/tick

// A miner's shape follows where it puts the energy, not just the spend cap.
// No container yet (early game): it must carry to the spawn, so it needs a
// CARRY. On a container: harvest overflow drops straight in, so CARRY is dead
// weight and every point goes to WORK. Feeding a link: CARRY comes back.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  // Pre-container compromise: 2 WORK is the least that justifies a dedicated
  // miner, and it still has to walk its energy to the spawn itself.
  if (!ctx.hasContainer) return [WORK, WORK, CARRY, MOVE];

  // A source yields 10 energy/tick and one WORK harvests 2, so 5 WORK drains
  // it completely — anything past that is parts the room paid for and wastes.
  // A parked miner barely moves, so MOVE is bought last, out of whatever the
  // WORK parts leave behind — up to the usual 1 MOVE per 2 WORK, never zero.
  const carry = ctx.hasLink ? 1 : 0; // a link must be transferred into
  const budget = energy - carry * 50;
  const work = Math.min(SOURCE_SATURATING_WORK, Math.max(1, Math.floor((budget - 50) / 100)));
  const move = Math.max(1, Math.min(Math.ceil(work / 2), Math.floor((budget - work * 100) / 50)));

  return [
    ...(new Array<BodyPartConstant>(work).fill(WORK)),
    ...(new Array<BodyPartConstant>(carry).fill(CARRY)),
    ...(new Array<BodyPartConstant>(move).fill(MOVE))
  ];
}

// Ported from HaulerOperation's carry-parts math: CARRY,CARRY,MOVE sets
// (2:1, enough MOVE to stay at speed on roads) repeated up to the energy
// cap, never fewer than one set.
function haulerBody(energy: number): BodyPartConstant[] {
  const sets = Math.min(16, Math.max(1, Math.floor(energy / 150))); // 16 sets = 48 parts
  let parts: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    parts = parts.concat([CARRY, CARRY, MOVE]);
  }
  return parts;
}

export const ROLES = {
  // Old Allrounder priority order, recast as a wrap-around step loop: steps
  // with no valid target are skipped, so this covers supply, build and upgrade.
  bootstrap: {
    body: bootstrapBody,
    steps: [
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
      { do: "build" },
      { do: "upgrade" }
    ]
  },
  // Ported from Builder's job priority (the Build* jobs, then PickupNearest),
  // recast forward: refill from storage, then a container, then fall back to
  // harvesting a source directly, and spend it on whatever site is nearest.
  // Body is Allrounder's formula — legacy Builder.getBody is the same
  // WORK/CARRY/MOVE set calculation, so bootstrapBody covers both.
  builder: {
    body: bootstrapBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "harvest", from: { find: "source" } },
      { do: "build" }
    ]
  },
  // Ported from Upgrader's job priority (Upgrade > PickupControllerLink >
  // PickupStorage), recast forward: refill from the controller link, then
  // storage, then spend it upgrading.
  upgrader: {
    body: upgraderBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "upgrade" }
    ]
  },
  // Ported from Miner/MineContainer: sit on the source and fill whatever sink
  // exists. With a container underneath, the transfer steps mostly no-op —
  // harvest overflow already lands in it.
  miner: {
    body: minerBody,
    steps: [
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
    ]
  },
  // The inverse of hauler: hauler moves energy from mining containers INTO
  // storage, supply moves it back OUT to the structures that must be kept full
  // for spawning to work. Old SupplyExtension/SupplySpawn collapse into this
  // one row (docs/rewrite-skeleton.md §5). Storage is the intended source; the
  // container fallback covers a room whose storage is empty or not yet built,
  // so supply still functions as the extension filler before storage exists.
  supply: {
    body: haulerBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
    ]
  },
  // Ported from Hauler's pickup/deliver loop: drain mining containers into
  // storage; before storage exists, the spawn is the only sink worth filling.
  hauler: {
    body: haulerBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
    ]
  }
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
