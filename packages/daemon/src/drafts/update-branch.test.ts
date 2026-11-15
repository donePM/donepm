import type { PrStatus } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import type { ResumeHow } from "../agent/start.js";
import { draftStores } from "../test-support/draft-stores.js";
import { fail, fakeExec, ok, type FakeCall } from "../test-support/fake-exec.js";
import { DraftError, rejectionMessage } from "./actions.js";
import { approveDraft, ExecutionError } from "./execute.js";
import { createUpdateBranchDraft } from "./update-branch.js";

const PR_URL = "https://github.com/o/r/pull/1";
const BEHIND: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", mergeState: "BEHIND", base: "minor" };

/** `item-1` as someone else's pull request under review, behind `minor`, its agent running. */
function setup(author = "octocat", routes: Parameters<typeof fakeExec>[0] = {}, prStatus: PrStatus = BEHIND) {
  const t = draftStores();
  const item = t.items.get("item-1")!.item;
  t.items.update({ ...item, source: "github-pr", externalUrl: PR_URL, playbook: "review", baseBranch: "minor", author, prStatus });
  const exec = fakeExec({
    "gh pr update-branch": ok("✓ PR branch updated\n"),
    "gh pr comment": ok(`${PR_URL}#issuecomment-7\n`),
    ...routes,
  });
  const continued: ResumeHow[] = [];
  const stopped: string[] = [];
  const deps = {
    ...t.deps, exec, providers: githubProviders(exec),
    stopAgent: async (id: string) => void stopped.push(id),
    continueAgent: async (id: string, how: ResumeHow) => {
      continued.push(how);
      t.deps.writer.commit(how.transition(t.items.get(id)!.item, t.deps.ctx));
    },
  };
  return { ...t, exec, deps, continued, stopped };
}

const line = (c: FakeCall) => [c.cmd, ...c.args].join(" ");

describe("createUpdateBranchDraft (issue #148)", () => {
  it("stores a pending draft with the PR and how, and moves the item to needs_you", () => {
    const t = setup();
    const d = createUpdateBranchDraft(t.deps, "item-1", { reason: " Branch protection wants it up to date. " });
    expect(t.drafts.get(d.id)).toEqual({
      id: d.id, itemId: "item-1", type: "update_branch", state: "pending",
      payload: { number: 1, url: PR_URL, base: "minor", via: "update-branch", reason: "Branch protection wants it up to date." },
    });
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "draft.created", actor: "agent", refId: d.id, payload: { type: "update_branch", title: "Update the branch of PR #1" },
    });
  });

  it("knows Dependabot is asked to rebase", () => {
    const t = setup("dependabot[bot]");
    const d = createUpdateBranchDraft(t.deps, "item-1", { reason: "behind" });
    expect(d.payload.via).toBe("dependabot");
  });

  it("refuses when the last poll did not read the branch as behind", () => {
    const t = setup("octocat", {}, { ...BEHIND, mergeState: "CLEAN" });
    expect(() => createUpdateBranchDraft(t.deps, "item-1", { reason: "x" })).toThrow(DraftError);
    expect(() => createUpdateBranchDraft(t.deps, "item-1", { reason: "x" })).toThrow("the branch cannot be updated: the branch is not behind minor (as of the last poll)");
    expect(t.state()).toBe("running");
  });

  it("refuses an issue item", () => {
    const t = draftStores();
    expect(() => createUpdateBranchDraft(t.deps, "item-1", { reason: "x" })).toThrow("only for a pull request under review");
  });
});

describe("approving an update-branch draft", () => {
  it("runs gh pr update-branch, then lets the agent go on with its review", async () => {
    const t = setup();
    const d = createUpdateBranchDraft(t.deps, "item-1", { reason: "behind" });
    const done = await approveDraft(t.deps, d.id);
    expect(t.exec.calls.map(line)).toEqual(["gh pr update-branch 1 --repo github.com/o/r"]);
    expect(done).toMatchObject({ state: "executed", result: { via: "update-branch" } });
    expect(t.drafts.get(d.id)).toMatchObject({ state: "executed", result: { via: "update-branch" } });
    expect(t.stopped).toEqual([]);
    expect(t.continued[0]!.prompt).toContain("call draft_review once, at the end");
    expect(t.state()).toBe("running");
    expect(t.types().slice(-2)).toEqual(["draft.approved", "draft.executed"]);
  });

  it("posts @dependabot rebase for a Dependabot pull request", async () => {
    const t = setup("dependabot[bot]");
    const d = createUpdateBranchDraft(t.deps, "item-1", { reason: "behind" });
    const done = await approveDraft(t.deps, d.id);
    expect(t.exec.calls.map(line)[0]).toMatch(/^gh pr comment 1 --repo github\.com\/o\/r --body-file /);
    expect(done).toMatchObject({ result: { via: "dependabot", url: `${PR_URL}#issuecomment-7` } });
    expect(t.continued[0]!.prompt).toContain("@dependabot rebase");
  });

  it("marks the draft failed and keeps the item waiting when gh fails", async () => {
    const t = setup("octocat", { "gh pr update-branch": fail("HTTP 422") });
    const d = createUpdateBranchDraft(t.deps, "item-1", { reason: "behind" });
    await expect(approveDraft(t.deps, d.id)).rejects.toThrow(ExecutionError);
    expect(t.drafts.get(d.id)!.state).toBe("failed");
    expect(t.continued).toEqual([]);
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.execution_failed", payload: { step: "update_branch", error: "updating the branch failed: HTTP 422" } });
  });
});

describe("rejectionMessage for an update-branch draft", () => {
  it("tells the agent to leave the branch and finish the review", () => {
    expect(rejectionMessage(undefined, "update_branch")).toContain("Leave the branch as it is. Go on with your review and call draft_review once, at the end.");
  });
});
