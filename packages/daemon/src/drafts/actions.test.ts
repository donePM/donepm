import { describe, expect, it } from "vitest";
import { draftStores } from "../test-support/draft-stores.js";
import { createPrDraft, DraftError, editDraft, rejectDraft, rejectionMessage, type RejectDeps } from "./actions.js";

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
    if (stored.type !== "pr") throw new Error("expected a PR draft");
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
  const noResume = async () => {
    throw new Error("unexpected resume");
  };

  it("rejects, runs the item again and tells the agent why", async () => {
    const t = draftStores();
    const said: string[] = [];
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    await rejectDraft({ ...t.deps, agentAlive: () => true, say: (_id, text) => said.push(text), resume: noResume }, d.id, "Add tests");
    expect(t.drafts.get(d.id)!.state).toBe("rejected");
    expect(t.state()).toBe("running");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.rejected", actor: "user", payload: { reason: "Add tests" } });
    expect(said).toEqual([rejectionMessage("Add tests")]);
    expect(said[0]).toContain("Add tests");
  });

  it("resumes the session with the rejection as its first message when the agent is gone", async () => {
    const t = draftStores();
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    const prompts: string[] = [];
    const resume: RejectDeps["resume"] = async (itemId, how) => {
      t.deps.writer.commit(how.transition(t.deps.items.get(itemId)!.item, t.deps.ctx));
      prompts.push(how.prompt);
    };
    await rejectDraft({ ...t.deps, agentAlive: () => false, say: () => {}, resume }, d.id, "Add tests");
    expect(prompts).toEqual([rejectionMessage("Add tests")]);
    expect(t.drafts.get(d.id)!.state).toBe("rejected");
    expect(t.state()).toBe("running");
    expect(t.types().at(-1)).toBe("draft.rejected");
  });

  it("changes nothing when the session cannot resume", async () => {
    const t = draftStores();
    const d = createPrDraft(t.deps, "item-1", { title: "A", body: "" });
    const resume = async () => {
      throw new Error("no agent session to resume");
    };
    await expect(rejectDraft({ ...t.deps, agentAlive: () => false, say: () => {}, resume }, d.id, undefined)).rejects.toThrow(/no agent session/);
    expect(t.drafts.get(d.id)!.state).toBe("pending");
    expect(t.state()).toBe("needs_you");
  });
});
