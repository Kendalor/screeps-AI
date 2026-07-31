// Pure fixture tests, no Game mocking — a hand-built ColonySnapshot in, linkSend Intent[] out.

import { describe, expect, it } from "vitest";
import { planLinkTransfers } from "../../../src/logistics/links";
import { colonySnap, linkAt } from "../../fixtures";

describe("planLinkTransfers", () => {
  it("does nothing with no links built yet", () => {
    expect(planLinkTransfers(colonySnap({}))).toEqual([]);
  });

  it("does nothing when a source link exists but the anchor link isn't recorded yet", () => {
    const sourceLink = linkAt(10, 10, 700);
    const colony = colonySnap({
      links: [sourceLink],
      sourceMemory: { src_0: { linkId: sourceLink.id } }
      // linkNetwork.storage deliberately absent — not yet detected/recorded.
    });
    expect(planLinkTransfers(colony)).toEqual([]);
  });

  it("sends from a full-enough source link to the recorded anchor link", () => {
    const sourceLink = linkAt(10, 10, 700);
    const anchorLinkFixture = linkAt(25, 24, 0);
    const colony = colonySnap({
      links: [sourceLink, anchorLinkFixture],
      sourceMemory: { src_0: { linkId: sourceLink.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([{ kind: "linkSend", from: sourceLink.id, to: anchorLinkFixture.id }]);
  });

  it("does not send a source link below the worthwhile floor", () => {
    const sourceLink = linkAt(10, 10, 300); // below 50% of 800 capacity
    const anchorLinkFixture = linkAt(25, 24, 0);
    const colony = colonySnap({
      links: [sourceLink, anchorLinkFixture],
      sourceMemory: { src_0: { linkId: sourceLink.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([]);
  });

  it("does not send from a link still on cooldown", () => {
    const sourceLink = linkAt(10, 10, 700, { cooldown: 3 });
    const anchorLinkFixture = linkAt(25, 24, 0);
    const colony = colonySnap({
      links: [sourceLink, anchorLinkFixture],
      sourceMemory: { src_0: { linkId: sourceLink.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([]);
  });

  it("does not send once the anchor link has no free capacity left", () => {
    const sourceLink = linkAt(10, 10, 700);
    const anchorLinkFixture = linkAt(25, 24, 800); // already full
    const colony = colonySnap({
      links: [sourceLink, anchorLinkFixture],
      sourceMemory: { src_0: { linkId: sourceLink.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([]);
  });

  it("sends from multiple staffed source links in the same tick, stopping once the anchor fills", () => {
    const sourceA = linkAt(10, 10, 700);
    const sourceB = linkAt(12, 12, 700);
    const anchorLinkFixture = linkAt(25, 24, 750, { storeCapacity: 800 }); // only 50 free
    const colony = colonySnap({
      links: [sourceA, sourceB, anchorLinkFixture],
      sourceMemory: { src_0: { linkId: sourceA.id }, src_1: { linkId: sourceB.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    // Anchor has only 50 free; sourceA's send is modeled as filling it entirely (a link send moves its
    // full load, see links.ts), so sourceB must not also be sent this same tick past that capacity.
    const result = planLinkTransfers(colony);
    expect(result).toEqual([{ kind: "linkSend", from: sourceA.id, to: anchorLinkFixture.id }]);
  });

  it("never sends the anchor link to itself even if some other link is (wrongly) also recorded as it", () => {
    const anchorLinkFixture = linkAt(25, 24, 800);
    const colony = colonySnap({
      links: [anchorLinkFixture],
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([]);
  });

  it("ignores an unrelated built link that is neither the recorded anchor nor a recorded source link", () => {
    // Regression: W8N3 live had a second, pre-existing link near the controller that predated linkId
    // tracking. Before linkNetwork-based lookup, "not a source link" alone picked this one as the
    // anchor link nondeterministically. Now it's simply invisible to planLinkTransfers until recorded.
    const sourceLink = linkAt(10, 10, 700);
    const anchorLinkFixture = linkAt(25, 24, 0);
    const mysteryLink = linkAt(21, 40, 0);
    const colony = colonySnap({
      links: [sourceLink, anchorLinkFixture, mysteryLink],
      sourceMemory: { src_0: { linkId: sourceLink.id } },
      linkNetwork: { storage: anchorLinkFixture.id }
    });
    expect(planLinkTransfers(colony)).toEqual([{ kind: "linkSend", from: sourceLink.id, to: anchorLinkFixture.id }]);
  });

  describe("the controller leg", () => {
    it("forwards from the anchor link to the controller link once both are recorded", () => {
      const sourceLink = linkAt(10, 10, 700);
      const anchorLinkFixture = linkAt(25, 24, 700); // already holding a load to forward on
      const controllerLinkFixture = linkAt(21, 40, 0);
      const colony = colonySnap({
        links: [sourceLink, anchorLinkFixture, controllerLinkFixture],
        sourceMemory: { src_0: { linkId: sourceLink.id } },
        linkNetwork: { storage: anchorLinkFixture.id, controller: controllerLinkFixture.id }
      });
      expect(planLinkTransfers(colony)).toEqual([
        { kind: "linkSend", from: sourceLink.id, to: anchorLinkFixture.id },
        { kind: "linkSend", from: anchorLinkFixture.id, to: controllerLinkFixture.id }
      ]);
    });

    it("does not forward to the controller link when the anchor link isn't full enough yet", () => {
      const anchorLinkFixture = linkAt(25, 24, 300); // below the 50% floor
      const controllerLinkFixture = linkAt(21, 40, 0);
      const colony = colonySnap({
        links: [anchorLinkFixture, controllerLinkFixture],
        linkNetwork: { storage: anchorLinkFixture.id, controller: controllerLinkFixture.id }
      });
      expect(planLinkTransfers(colony)).toEqual([]);
    });

    it("does nothing on the controller leg when no controller link is recorded yet", () => {
      const anchorLinkFixture = linkAt(25, 24, 700);
      const colony = colonySnap({
        links: [anchorLinkFixture],
        linkNetwork: { storage: anchorLinkFixture.id }
      });
      expect(planLinkTransfers(colony)).toEqual([]);
    });
  });
});
