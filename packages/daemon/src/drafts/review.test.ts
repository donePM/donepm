import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftStores } from "../test-support/draft-stores.js";
import { fail, fakeExec, fixture, ok, type FakeCall } from "../test-support/fake-exec.js";
import { DraftError, rejectionMessage } from "./actions.js";
import { approveDraft, ExecutionError } from "./execute.js";
import { commentableLines, createReviewDraft } from "./review.js";

const PR_URL = "https://github.com/o/r/pull/1";
const HEAD = "c0ffee0000000000000000000000000000000000";
const POST = "gh api --hostname github.com --method POST repos/o/r/pulls/1/reviews --input";

/** `item-1` as a pull request under review into `minor`, its agent running. */
function setup(routes: Parameters<typeof fakeExec>[0] = {}) {
  const t = draftStores();
  const item = t.items.get("item-1")!.item;
  t.items.update({ ...item, source: "github-pr", externalUrl: PR_URL, playbook: "review", baseBranch: "minor" });
  let request: unknown;
  const exec = fakeExec({
    "git -C /wt/1 rev-parse HEAD": ok(`${HEAD}\n`),
    "git -C /wt/1 diff --no-color --no-ext-diff --no-prefix origin/minor...HEAD": ok(fixture("git/review.diff")),
    [POST]: (c: FakeCall) => {
      request = JSON.parse(readFileSync(c.args.at(-1)!, "utf8"));
      return ok(fixture("gh/pr-review-created.json"));
    },
    ...routes,
  });
  const stopped: string[] = [];
  const deps = { ...t.deps, exec, stopAgent: async (id: string) => void stopped.push(id) };
  return { ...t, exec, deps, stopped, request: () => request };
}

const comment = { path: "packages/web/src/time/duration.ts", line: 17, body: "What if `activeSince` is in the future?" };

describe("commentableLines", () => {
  it("lists the added and unchanged lines of each hunk on the new side", () => {
    const lines = commentableLines(fixture("git/review.diff"));
    expect([...lines.keys()]).toEqual([
      "packages/daemon/src/daemon.ts", "packages/web/src/board/ItemCard.vue", "packages/web/src/time/duration.ts",
    ]);
    expect([...lines.get("packages/web/src/time/duration.ts")!]).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const daemon = lines.get("packages/daemon/src/daemon.ts")!;
    expect([32, 35, 38, 120, 123, 126].every((n) => daemon.has(n))).toBe(true);
    expect([31, 39, 119, 127].some((n) => daemon.has(n))).toBe(false);
  });
});

describe("createReviewDraft (D43)", () => {
  it("stores a pending review pinned to the reviewed commit and moves the item to needs_you", async () => {
    const t = setup();
    const d = await createReviewDraft(t.deps, "item-1", { verdict: "REQUEST_CHANGES", body: " Needs a guard. ", comments: [comment] });
    expect(t.drafts.get(d.id)).toEqual({
      id: d.id, itemId: "item-1", type: "review", state: "pending",
      payload: { number: 1, url: PR_URL, commitId: HEAD, verdict: "REQUEST_CHANGES", body: "Needs a guard.", comments: [comment] },
    });
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "draft.created", actor: "agent", refId: d.id, payload: { type: "review", title: "Request changes on PR #1, 1 inline comment" },
    });
  });

  it("approves without a body or comments and does not read the diff", async () => {
    const t = setup();
    await createReviewDraft(t.deps, "item-1", { verdict: "APPROVE", body: "", comments: [] });
    expect(t.exec.calls.map((c) => c.args.slice(2, 3)[0])).toEqual(["rev-parse"]);
  });

  it("refuses comments outside the diff, a missing body and items that are not reviews, creating nothing", async () => {
    const t = setup();
    const create = (input: Parameters<typeof createReviewDraft>[2]) => createReviewDraft(t.deps, "item-1", input);
    await expect(create({ verdict: "COMMENT", body: "x", comments: [{ ...comment, line: 11 }] })).rejects.toThrow(/line 11 of .* is not in the diff/);
    await expect(create({ verdict: "COMMENT", body: "x", comments: [{ ...comment, path: "README.md" }] })).rejects.toThrow(/README\.md is not changed/);
    await expect(create({ verdict: "REQUEST_CHANGES", body: "  ", comments: [] })).rejects.toThrow(/needs a body/);
    await expect(create({ verdict: "COMMENT", body: "", comments: [comment] })).rejects.toThrow(/needs a body/);
    const item = t.items.get("item-1")!.item;
    t.items.update({ ...item, source: "github-issue" });
    await expect(create({ verdict: "APPROVE", body: "", comments: [] })).rejects.toThrow(DraftError);
    expect(t.drafts.forItem("item-1")).toEqual([]);
    expect(t.state()).toBe("running");
  });

  it("compares against the default branch when the item has no base", async () => {
    const t = setup({ "git -C /wt/1 diff --no-color --no-ext-diff --no-prefix origin/main...HEAD": ok(fixture("git/review.diff")) });
    const item = t.items.get("item-1")!.item;
    const { baseBranch: _base, ...noBase } = item;
    t.items.update(noBase);
    await createReviewDraft(t.deps, "item-1", { verdict: "COMMENT", body: "x", comments: [comment] });
    expect(t.state()).toBe("needs_you");
  });

  it("tells the agent how to answer a rejection", () => {
    expect(rejectionMessage("Too harsh.", "review")).toBe(
      "The user rejected your review.\n\nTheir reason:\nToo harsh.\n\nRevise the work and call draft_review again when it is ready.",
    );
  });
});

describe("approving a review draft", () => {
  it("posts one review with every inline comment on the reviewed commit, and the item is done", async () => {
    const t = setup();
    const d = await createReviewDraft(t.deps, "item-1", { verdict: "COMMENT", body: "One question.", comments: [comment] });
    t.exec.calls.length = 0;
    const done = await approveDraft(t.deps, d.id);
    expect(done).toMatchObject({ state: "executed", result: { id: 3311400001, url: "https://github.com/o/r/pull/7#pullrequestreview-3311400001" } });
    expect(t.exec.calls.map((c) => c.cmd)).toEqual(["gh"]);
    expect(t.request()).toEqual({
      commit_id: HEAD, event: "COMMENT", body: "One question.",
      comments: [{ path: comment.path, line: 17, side: "RIGHT", body: comment.body }],
    });
    expect(t.state()).toBe("done");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.executed", actor: "system", refId: d.id, payload: { id: 3311400001 } });
    expect(t.stopped).toEqual(["item-1"]);
  });

  it("marks the draft failed and keeps the item waiting when gh fails; Retry posts it", async () => {
    let answer = fail("HTTP 422: Unprocessable Entity (pull_request_review_thread.line must be part of the diff)");
    const t = setup({ [POST]: () => answer });
    const d = await createReviewDraft(t.deps, "item-1", { verdict: "APPROVE", body: "", comments: [] });
    const err = await approveDraft(t.deps, d.id).catch((e) => e);
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err).toMatchObject({ step: "review", message: expect.stringMatching(/^posting the review failed: HTTP 422/) });
    expect(t.drafts.get(d.id)!.state).toBe("failed");
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.execution_failed", payload: { step: "review" } });

    answer = ok(fixture("gh/pr-review-created.json"));
    await approveDraft(t.deps, d.id);
    expect(t.state()).toBe("done");
  });

  it("counts a review gh posted as posted even when its answer does not parse", async () => {
    const t = setup({ [POST]: ok("not json") });
    const d = await createReviewDraft(t.deps, "item-1", { verdict: "APPROVE", body: "", comments: [] });
    expect(await approveDraft(t.deps, d.id)).toMatchObject({ state: "executed", result: { id: 0, url: PR_URL } });
  });
});
