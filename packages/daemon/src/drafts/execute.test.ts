import { readFileSync } from "node:fs";
import { githubProviders } from "../gh/adapter.js";
import { agentFailed, ciFailed, ciFix, ciPassed, prFeedback, prFeedbackFix } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { draftStores } from "../test-support/draft-stores.js";
import { fail, fakeExec, ok, type FakeCall } from "../test-support/fake-exec.js";
import { createCommentDraft, createPrDraft, createPushDraft, editDraft } from "./actions.js";
import { approveDraft, ExecutionError, failInterrupted, WIP_MESSAGE } from "./execute.js";

const PR_URL = "https://github.com/o/r/pull/42";

function setup(routes: Parameters<typeof fakeExec>[0] = {}) {
  const t = draftStores();
  const stopped: string[] = [];
  let body: string | undefined;
  const exec = fakeExec({
    "git -C /wt/1 status --porcelain": ok(""),
    "git -C /wt/1 push": ok(""),
    "gh pr create": (call: FakeCall) => {
      body = readFileSync(call.args[call.args.indexOf("--body-file") + 1]!, "utf8");
      return ok(`Creating pull request…\n${PR_URL}\n`);
    },
    ...routes,
  });
  const deps = { ...t.deps, exec, providers: githubProviders(exec), stopAgent: async (id: string) => void stopped.push(id), continueAgent: async () => undefined };
  const draft = createPrDraft(t.deps, "item-1", { title: "Fix it", body: "Closes #1" });
  return { ...t, exec, deps, draft, stopped, body: () => body };
}

const lines = (calls: FakeCall[]) => calls.map((c) => [c.cmd, ...c.args].join(" "));

describe("approveDraft", () => {
  it("pushes, opens the PR with the user's edits and waits for CI", async () => {
    const t = setup();
    editDraft(t.deps, t.draft.id, { title: "Better title", body: "Edited body" });

    const done = await approveDraft(t.deps, t.draft.id);

    expect(done).toMatchObject({ state: "executed", result: { url: PR_URL, number: 42 } });
    expect(t.drafts.get(t.draft.id)).toMatchObject({ state: "executed", result: { url: PR_URL, number: 42 } });
    expect(lines(t.exec.calls)).toEqual([
      "git -C /wt/1 status --porcelain",
      "git -C /wt/1 push --set-upstream origin dp/1-fix-it",
      expect.stringMatching(/^gh pr create --repo github\.com\/o\/r --head dp\/1-fix-it --base main --title Better title --body-file \S+body\.md$/),
    ]);
    expect(t.body()).toBe("Edited body");
    expect(t.state()).toBe("checking");
    expect(t.types().slice(-3)).toEqual(["draft.approved", "draft.executed", "ci.started"]);
    expect(t.events.forItem("item-1").at(-2)).toMatchObject({ actor: "system", refId: t.draft.id, payload: { url: PR_URL, number: 42 } });
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ refId: t.draft.id, payload: { url: PR_URL, number: 42 } });
    expect(t.stopped).toEqual(["item-1"]);
  });

  it("pushes a push draft's commits to the open PR and waits for CI again", async () => {
    const t = setup({
      "git -C /wt/1 log": ok("c0ffee\tFix the test\n"),
      "git -C /wt/1 status --porcelain --untracked-files=all": ok(""),
      "git -C /wt/1 rev-parse HEAD": ok("c0ffee\n"),
    });
    await approveDraft(t.deps, t.draft.id);
    // CI went red and the user let the agent fix it.
    const { writer, ctx } = t.deps;
    const red = writer.commit(ciFailed(t.items.get("item-1")!.item, ctx, { number: 42, url: PR_URL, failed: [{ name: "test" }], logs: [] }));
    writer.commit(ciFix(writer.save({ ...red, agentSessionId: "s1" }), ctx));
    const push = await createPushDraft(t.deps, "item-1", { summary: "Fix the test" });
    t.exec.calls.length = 0;

    expect(await approveDraft(t.deps, push.id)).toMatchObject({ state: "executed", result: { sha: "c0ffee" } });
    expect(lines(t.exec.calls)).toEqual([
      "git -C /wt/1 status --porcelain",
      "git -C /wt/1 push --set-upstream origin dp/1-fix-it",
      "git -C /wt/1 rev-parse HEAD",
    ]);
    expect(t.state()).toBe("checking");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "ci.started", refId: push.id, payload: { number: 42, url: PR_URL } });
  });

  it("commits what the agent left uncommitted before pushing (D25)", async () => {
    const t = setup({
      "git -C /wt/1 status --porcelain": ok("?? new.ts\n M old.ts\n"),
      "git -C /wt/1 add": ok(""),
      "git -C /wt/1 diff --cached --quiet": fail("", 1),
      "git -C /wt/1 commit": ok(""),
    });
    await approveDraft(t.deps, t.draft.id);
    expect(lines(t.exec.calls).slice(0, 5)).toEqual([
      "git -C /wt/1 status --porcelain",
      "git -C /wt/1 add --all -- .",
      "git -C /wt/1 diff --cached --quiet",
      `git -C /wt/1 commit --message ${WIP_MESSAGE}`,
      "git -C /wt/1 push --set-upstream origin dp/1-fix-it",
    ]);
  });

  it("marks the draft failed and keeps the item waiting when the push fails; Retry runs it again", async () => {
    let pushes = 0;
    const t = setup({
      "git -C /wt/1 push": () => (++pushes === 1 ? fail("remote: Permission denied\nfatal: unable to access") : ok("")),
    });

    const err = await approveDraft(t.deps, t.draft.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err).toMatchObject({ step: "push", message: expect.stringContaining("Permission denied") });
    expect(t.drafts.get(t.draft.id)!.state).toBe("failed");
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "draft.execution_failed", actor: "system", payload: { step: "push", error: expect.stringContaining("Permission denied") },
    });
    expect(lines(t.exec.calls).some((l) => l.startsWith("gh "))).toBe(false);
    expect(t.stopped).toEqual([]);

    await approveDraft(t.deps, t.draft.id);
    expect(t.state()).toBe("checking");
  });

  it("fails when gh prints no pull request URL", async () => {
    const t = setup({ "gh pr create": ok("something else\n") });
    await expect(approveDraft(t.deps, t.draft.id)).rejects.toMatchObject({ step: "pr" });
    expect(t.drafts.get(t.draft.id)!.state).toBe("failed");
  });

  it("refuses settled drafts and items that are not waiting, running nothing", async () => {
    const t = setup();
    await expect(approveDraft(t.deps, "nope")).rejects.toMatchObject({ status: 404 });
    await approveDraft(t.deps, t.draft.id);
    await expect(approveDraft(t.deps, t.draft.id)).rejects.toMatchObject({ status: 409 });

    const u = setup();
    u.deps.writer.commit(agentFailed(u.items.get("item-1")!.item, u.deps.ctx, "boom"));
    await expect(approveDraft(u.deps, u.draft.id)).rejects.toMatchObject({ status: 409 });
    expect(u.exec.calls).toEqual([]);
    expect(u.drafts.get(u.draft.id)!.state).toBe("pending");
  });
});

describe("approveDraft: replies to review feedback (D39)", () => {
  /** The PR is open, a reviewer left an inline comment (thread 41), and the agent works on it. */
  async function addressing(routes: Parameters<typeof fakeExec>[0] = {}) {
    const t = setup({
      "git -C /wt/1 log": ok("c0ffee\tRename\n"),
      "git -C /wt/1 status --porcelain --untracked-files=all": ok(""),
      "git -C /wt/1 rev-parse HEAD": ok("c0ffee\n"),
      ...routes,
    });
    await approveDraft(t.deps, t.draft.id);
    const { writer, ctx } = t.deps;
    const done = writer.commit(ciPassed(t.items.get("item-1")!.item, ctx));
    const entry = { kind: "inline" as const, id: 41, author: "ana", body: "Rename", url: "u", at: "t", path: "a.ts", line: 1, thread: 41 };
    const back = writer.commit(prFeedback(done, ctx, { number: 42, url: PR_URL, entries: [entry] }));
    writer.commit(prFeedbackFix(writer.save({ ...back, agentSessionId: "s1" }), ctx));
    t.exec.calls.length = 0;
    return t;
  }

  it("pushes, then posts each reply, and waits for CI", async () => {
    const t = await addressing({
      "gh api": ok("https://github.com/o/r/pull/42#discussion_r50\n"),
      "gh pr comment": ok("https://github.com/o/r/pull/42#issuecomment-51\n"),
    });
    const push = await createPushDraft(t.deps, "item-1", { summary: "Rename", replies: [{ body: "Renamed.", inReplyTo: 41 }, { body: "Thanks!" }] });
    t.exec.calls.length = 0;
    expect(await approveDraft(t.deps, push.id)).toMatchObject({
      result: { sha: "c0ffee", posted: [{ index: 0, url: expect.stringContaining("r50") }, { index: 1, url: expect.stringContaining("comment-51") }] },
    });
    expect(lines(t.exec.calls).map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual([
      "git -C /wt/1", "git -C /wt/1", "git -C /wt/1", "gh api --hostname", "gh pr comment",
    ]);
    expect(t.state()).toBe("checking");
  });

  it("keeps what was posted when a reply fails, and a retry posts only the rest", async () => {
    let comments = 0;
    const t = await addressing({
      "gh api": ok("https://github.com/o/r/pull/42#discussion_r50\n"),
      "gh pr comment": () => (++comments === 1 ? fail("HTTP 502") : ok("https://github.com/o/r/pull/42#issuecomment-51\n")),
    });
    const push = await createPushDraft(t.deps, "item-1", { summary: "Rename", replies: [{ body: "Renamed.", inReplyTo: 41 }, { body: "Thanks!" }] });
    await expect(approveDraft(t.deps, push.id)).rejects.toMatchObject({ step: "reply", message: "posting reply 2 of 2 failed: HTTP 502" });
    expect(t.drafts.get(push.id)).toMatchObject({ state: "failed", result: { posted: [{ index: 0 }] } });
    expect(t.state()).toBe("needs_you");

    t.exec.calls.length = 0;
    await approveDraft(t.deps, push.id);
    expect(lines(t.exec.calls).filter((l) => l.startsWith("gh "))).toEqual([expect.stringMatching(/^gh pr comment 42 /)]);
    expect(t.drafts.get(push.id)).toMatchObject({ state: "executed", result: { posted: [{ index: 0 }, { index: 1 }] } });
    expect(t.state()).toBe("checking");
  });

  it("a comment draft only posts, and the item is done again", async () => {
    const t = await addressing({ "gh api": ok("https://github.com/o/r/pull/42#discussion_r50\n") });
    const comment = createCommentDraft(t.deps, "item-1", { replies: [{ body: "It is on purpose.", inReplyTo: 41 }] });
    await approveDraft(t.deps, comment.id);
    expect(lines(t.exec.calls)).toEqual([expect.stringMatching(/^gh api --hostname github\.com --method POST repos\/o\/r\/pulls\/42\/comments\/41\/replies /)]);
    expect(t.state()).toBe("done");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.executed", refId: comment.id, payload: { posted: [{ index: 0 }] } });
    expect(t.stopped.at(-1)).toBe("item-1");
  });
});

describe("failInterrupted", () => {
  it("fails drafts left approved by a stopped daemon, so they can be retried", async () => {
    const t = setup();
    t.drafts.setState(t.draft.id, "approved", "now");
    failInterrupted(t.deps);
    expect(t.drafts.get(t.draft.id)!.state).toBe("failed");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.execution_failed", refId: t.draft.id });
    expect(t.state()).toBe("needs_you");
    await approveDraft(t.deps, t.draft.id);
    expect(t.state()).toBe("checking");
  });
});
