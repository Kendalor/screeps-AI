// Per-tick link firing: the one thing a link can do that no creep-based provider/consumer pair can
// (an instant, no-travel, no-decay transfer). Pure — reads the snapshot, returns linkSend intents;
// execute.ts owns the actual StructureLink.transferEnergy call.
//
// Two legs, both source-fed: every source link -> the anchor/storage link (so mined energy reaches
// storage without a hauler leg), and the anchor link -> the controller link (so the upgrader squad's
// feed is topped up too, replacing what the controller container used to receive by hand). Which link
// is which role is resolved via colony.linkNetwork (see snapshot/types.ts's SnapLinkNetwork) — recorded
// once each is built (operations/logistics.ts for the anchor link, operations/upgrading.ts for the
// controller link) — rather than guessed structurally, since a room can have OTHER links (e.g. a
// pre-existing/manually-placed one) that aren't part of either role.

import type { Intent } from "../intents/types";
import type { ColonySnapshot, SnapLink } from "../snapshot/types";

// A link only worth firing once it's carrying enough to justify the transfer loss (link send costs
// ~3% of the amount moved) — a send worth firing at all is one that's meaningfully full, not a dribble.
// Fractional so it scales with whatever capacity a link actually has (800 always, but keeps this
// independent of the hardcoded game constant).
const SEND_FLOOR = 0.5;

function findLink(colony: ColonySnapshot, id: Id<StructureLink> | undefined): SnapLink | undefined {
  return id ? colony.links.find(l => l.id === id) : undefined;
}

function worthSending(link: SnapLink): boolean {
  return link.cooldown === 0 && link.storeEnergy >= Math.floor(link.storeCapacity * SEND_FLOOR);
}

// One sender -> one receiver: every eligible sender not already the receiver itself sends, in the order
// given, decrementing the receiver's modeled free capacity as each send is queued so two senders this
// same tick can't both target it past capacity. A link send moves its FULL load (no partial-amount
// concept beyond what's requested), so the receiver is modeled as filling by the sender's whole load —
// conservative: the real engine call still only ever moves min(sender's energy, transfer cost budget).
function sendAllTo(senders: readonly SnapLink[], receiver: SnapLink): Intent[] {
  const out: Intent[] = [];
  let receiverFree = receiver.storeCapacity - receiver.storeEnergy;

  for (const link of senders) {
    if (link.id === receiver.id) continue;
    if (receiverFree <= 0) break;
    if (!worthSending(link)) continue;

    out.push({ kind: "linkSend", from: link.id, to: receiver.id });
    receiverFree -= link.storeEnergy;
  }

  return out;
}

export function planLinkTransfers(colony: ColonySnapshot): Intent[] {
  const anchorLink = findLink(colony, colony.linkNetwork.storage);
  const controllerLink = findLink(colony, colony.linkNetwork.controller);

  const sourceLinkIds = new Set(
    Object.values(colony.sourceMemory)
      .map(m => m?.linkId)
      .filter((id): id is Id<StructureLink> => id !== undefined)
  );
  const sourceLinks = colony.links.filter(l => sourceLinkIds.has(l.id));

  const out: Intent[] = [];
  if (anchorLink) out.push(...sendAllTo(sourceLinks, anchorLink));
  // The anchor link only ever sends onward to the controller link once it actually has something to
  // give — worthSending's own floor/cooldown check on the anchor link covers that, same as any sender.
  if (anchorLink && controllerLink) out.push(...sendAllTo([anchorLink], controllerLink));

  return out;
}
