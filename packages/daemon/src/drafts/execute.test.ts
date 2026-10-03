import { readFileSync } from "node:fs";
import { agentFailed } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { draftStores } from "../test-support/draft-stores.js";
import { fail, fakeExec, ok, type FakeCall } from "../test-support/fake-exec.js";
import { createPrDraft, editDraft } from "./actions.js";
import { approveDraft, ExecutionError, failInterrupted, prResult, WIP_MESSAGE } from "./execute.js";

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
  const deps = { ...t.deps, exec, stopAgent: async (id: string) => void stopped.push(id) };
  const draft = createPrDraft(t.deps, "item-1", { title: "Fix it", body: "Closes #1" });
  return { ...t, exec, deps, draft, stopped, body: () => body };
}

const lines = (calls: FakeCall[]) => calls.map((c) => [c.cmd, ...c.args].join(" "));

describe("approveDraft", () => {
  it("pushes, opens the PR with the user's edits and moves the item to done", async () => {
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
    expect(t.state()).toBe("done");
    expect(t.types().slice(-2)).toEqual(["draft.approved", "draft.executed"]);
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ actor: "system", refId: t.draft.id, payload: { url: PR_URL, number: 42 } });
    expect(t.stopped).toEqual(["item-1"]);
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
    expect(t.state()).toBe("done");
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

describe("failInterrupted", () => {
  it("fails drafts left approved by a stopped daemon, so they can be retried", async () => {
    const t = setup();
    t.drafts.setState(t.draft.id, "approved", "now");
    failInterrupted(t.deps);
    expect(t.drafts.get(t.draft.id)!.state).toBe("failed");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.execution_failed", refId: t.draft.id });
    expect(t.state()).toBe("needs_you");
    await approveDraft(t.deps, t.draft.id);
    expect(t.state()).toBe("done");
  });
});

describe("prResult", () => {
  it("takes the URL from the last line", () => {
    expect(prResult("Warning: 1 uncommitted change\nhttps://github.com/o/r/pull/7\n")).toEqual({ url: "https://github.com/o/r/pull/7", number: 7 });
  });
});
