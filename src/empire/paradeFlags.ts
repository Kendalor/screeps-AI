// Flag-triggered Parade entry point — same "flag is the operation's lifetime" shape as drainFlags.ts, but
// Parade has no target ROOM at all: the flag itself IS the live destination (see operations/parade.ts's
// header). A flag named "parade" (or "parade:<...>") both starts a marching formation (pick the nearest
// affordable colony, hand the flag name + squad shape off via setParadeTarget) AND keeps it alive — the
// flag stays in place after handoff, and the moment it's gone, the next tick's pass here clears
// ColonyMemory.parading via clearParadeTarget, detaching the Parade operation. The squad then just walks
// to wherever the SAME flag currently sits every subsequent tick (ColonySnapshot.paradeGoal, read fresh
// from Game.flags at the snapshot boundary) — dragging the flag in the client is enough to redirect an
// already-marching squad, no new handoff needed.
//
// Naming: "parade", "parade:<shape>", "parade:<room>", or "parade:<room>:<shape>" — unlike drain/attack
// (which take a single optional room suffix), Parade takes two independent optional parameters (which
// colony's room to spawn near, and what squad shape to march in), so a single ":<suffix>" position is
// ambiguous between them. Resolved by CONTENT, not position: whichever colon-separated segment matches a
// room-name pattern (e.g. "W2N1") is the room; whichever matches "<cols>x<rows>" (e.g. "2x2") is the
// shape; segments are order-independent so "parade:2x2:W2N1" works identically to "parade:W2N1:2x2". A
// bare "parade" flag falls back to its own physical room the same way drain/attack's bare form does, and
// to DEFAULT_PARADE_FORMATION ("2x2") when no shape segment is given.
//
// Two passes per tick, identical structure to runDrainFlags: (1) every parade flag resolves/re-affirms its
// handoff (never removed on success — it's the live marker); (2) every colony currently parading gets
// checked against the current flag set, and any colony whose flag is gone gets cleared.

import { pickParadeSponsor } from "./paradeSponsor";
import { execute } from "../intents/execute";
import { log } from "../lib/log";
import { DEFAULT_PARADE_FORMATION } from "../operations/parade";
import type { Empire } from "./index";

const FLAG_PREFIX = "parade";
const ROOM_SEGMENT = /^[WE]\d+[NS]\d+$/;
const SHAPE_SEGMENT = /^\d+x\d+$/;

interface ParadeFlagRequest {
  flag: Flag;
  room: string | undefined;
  formation: string;
}

/** Parses a parade flag's name into its room (explicit segment, else the flag's own physical room when it
 * has vision, else undefined) and formation shape (explicit segment, else the default). Segments are
 * matched by content, not position — see file header for why. An unrecognized segment (neither a room nor
 * a shape) is ignored rather than rejecting the whole flag, so a typo degrades to "use the defaults" for
 * whichever half it wasn't, not a total parse failure. */
function parseParadeFlag(flag: Flag): ParadeFlagRequest {
  const segments = flag.name.split(":").slice(1);
  const roomSegment = segments.find(s => ROOM_SEGMENT.test(s));
  const shapeSegment = segments.find(s => SHAPE_SEGMENT.test(s));
  const room = roomSegment ?? (Game.rooms[flag.pos.roomName] ? flag.pos.roomName : undefined);
  return { flag, room, formation: shapeSegment ?? DEFAULT_PARADE_FORMATION };
}

/** Every flag whose name marks it as a parade request ("parade" or "parade:...")—same membership test
 * shape as drainFlags' drainFlags(). */
function paradeFlagRequests(): ParadeFlagRequest[] {
  return Object.values(Game.flags)
    .filter(f => f.name === FLAG_PREFIX || f.name.startsWith(`${FLAG_PREFIX}:`))
    .map(parseParadeFlag);
}

/** Runs once per tick from kernel/tick.ts. Resolves every active parade flag against the current empire,
 * hands the flag+shape off to the nearest affordable colony with no parade of its own already in progress,
 * and clears any colony whose parade flag is gone — the flag's presence IS the operation's lifetime (see
 * file header). */
export function runParadeFlags(world: Empire): void {
  const requests = paradeFlagRequests();
  const liveFlagNames = new Set(requests.map(r => r.flag.name));

  for (const { flag, room, formation } of requests) {
    if (!room) {
      log.error(`parade flag "${flag.name}": can't tell which room to spawn near — place it in-room or name it "parade:<room>"`);
      continue;
    }

    // Already handed off for this exact flag: don't pick a second sponsor while one's already marching it.
    const alreadySent = world.colonies.some(c => c.snapshot.parading?.flag === flag.name);
    if (alreadySent) continue;

    // A colony already parading a *different* flag isn't an eligible sponsor for a new one — one active
    // parade per colony at a time, same rule ADR 0006 fixes for drain.
    const eligible = world.colonies.filter(c => c.snapshot.parading === undefined);

    const pick = pickParadeSponsor(eligible, room, (a, b) => routeDistance(a, b));
    if (!pick.colony) {
      log.error(`parade flag "${flag.name}": no fitting colony for ${room} (${pick.reason})`);
      continue;
    }

    execute([{ kind: "setParadeTarget", room: pick.colony.name, flag: flag.name, formation }]);
    log.info(`parade flag "${flag.name}": handed off to ${pick.colony.name} (formation ${formation})`);
    // Flag deliberately left in place: it's the live on/off switch AND the live destination for this
    // parade (see file header) — removing it here would sever both the moment the handoff succeeds.
  }

  // The flag is gone for a colony that's still parading: stop it — this is what makes flag removal
  // actually turn a parade off instead of just blocking new recruitment.
  for (const colony of world.colonies) {
    const parading = colony.snapshot.parading;
    if (parading !== undefined && !liveFlagNames.has(parading.flag)) {
      execute([{ kind: "clearParadeTarget", room: colony.name }]);
      log.info(`parade flag "${parading.flag}" is gone: stopping ${colony.name}'s parade`);
    }
  }
}

// Real room-graph route length, same convention drainFlags.ts's routeDistance uses.
function routeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const route = Game.map.findRoute(a, b);
  return route === ERR_NO_PATH ? Infinity : route.length;
}
