import { describe, expect, it } from "vitest";
import { draftStores } from "../test-support/draft-stores.js";
import { createPrDraft, DraftError, editDraft, rejectDraft, rejectionMessage } from "./actions.js";

describe("createPrDraft", () => {
  it("stores a pending PR draft against the default branch and moves the item to needs_you", () => {
    const t = draftStores();
    const d = createPrDraft(t.deps, "item-1", { title: "Fix it", body: "Closes #1" });
    expect(t.drafts.get(d.id)).toEqual({
      id: d.id, itemId: "item-1", type: "pr", state: "pending", payload: { title: "Fix it", body: "Closes #1", base: "main" },
    });
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.created", actor: "agent", refId: d.id });
  });

  it("refuses a second draft while one is pending, and an item that is not running", () => {
    const t = draftStores();
    createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    expect(() => createPrDraft(t.deps, "item-1", { title: "B", body: "" })).toThrow(/needs_you/);
    expect(() => createPrDraft(t.deps, "nope", { title: "B", body: "" })).toThrow(DraftError);
    expect(t.drafts.forItem("item-1")).toHaveLength(1);
  });
});

describe("editDraft", () => {
  it("keeps the agent's payload and stores the merged edits", () => {
    const t = draftStores();
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "b" });
    editDraft(t.deps, d.id, { title: "Better" });
    editDraft(t.deps, d.id, { body: "longer" });
    const stored = t.drafts.get(d.id)!;
    expect(stored.payload).toEqual({ title: "A", body: "b", base: "main" });
    expect(stored.userEdits).toEqual({ title: "Better", body: "longer", base: "main" });
    expect(t.state()).toBe("needs_you");
    expect(t.types().slice(-2)).toEqual(["draft.edited", "draft.edited"]);
  });

  it("refuses unknown and settled drafts", () => {
    const t = draftStores();
    expect(() => editDraft(t.deps, "nope", {})).toThrow(expect.objectContaining({ status: 404 }));
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    t.drafts.setState(d.id, "rejected", "now");
    expect(() => editDraft(t.deps, d.id, {})).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("rejectDraft", () => {
  it("rejects, runs the item again and tells the agent why", () => {
    const t = draftStores();
    const said: string[] = [];
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    rejectDraft({ ...t.deps, agentAlive: () => true, say: (_id, text) => said.push(text) }, d.id, "Add tests");
    expect(t.drafts.get(d.id)!.state).toBe("rejected");
    expect(t.state()).toBe("running");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.rejected", actor: "user", payload: { reason: "Add tests" } });
    expect(said).toEqual([rejectionMessage("Add tests")]);
    expect(said[0]).toContain("Add tests");
  });

  it("refuses when no agent is there to hear it, changing nothing", () => {
    const t = draftStores();
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    expect(() => rejectDraft({ ...t.deps, agentAlive: () => false, say: () => {} }, d.id, undefined)).toThrow(/not running/);
    expect(t.drafts.get(d.id)!.state).toBe("pending");
    expect(t.state()).toBe("needs_you");
  });
});
