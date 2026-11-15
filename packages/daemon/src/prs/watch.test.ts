import { existsSync, writeFileSync } from "node:fs";
import { githubProviders } from "../gh/adapter.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ciPassed, draftCreated, draftExecuted, prConflictDismissed, prConflictOf, prFeedbackDismissed, prFeedbackOf, start, type WorkItem,
} from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { DraftStore } from "../drafts/store.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { exec as realExec, type Exec } from "../process/exec.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { watchPrs } from "./watch.js";

const PR = { url: "https://github.com/acme/widgets/pull/45", number: 45 };

/** A done (or CI-waiting) item whose draft opened PR #45, with a real worktree; gh answers `prView`. */
async function setup(opts: { removeOnMerge: boolean; prView?: () => string; ghFails?: boolean; checking?: boolean; feedback?: () => string }) {
  const { clone } = await cloneWithOrigin({ ".donepm/setup.yml": "copy:\n  - .env.local\n" });
  const worktree = join(clone, "..", "wt-45");
  git(clone, "worktree", "add", "-q", "-b", "dp/45-fix", worktree);

  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const drafts = new DraftStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  repos.upsert({ id: "repo-1", path: clone, originUrl: "github.com/acme/widgets", defaultBranch: "main" }, ctx.now());
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "acme/widgets#45", externalUrl: "https://github.com/acme/widgets/issues/45",
    repoId: "repo-1", title: "Fix", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), branch: "dp/45-fix", worktreePath: worktree,
  };
  items.insert(item, "github.com/acme/widgets");
  let current = writer.commit(start(item, ctx));
  drafts.insert({ id: "d-1", itemId: item.id, type: "pr", payload: { title: "Fix", body: "", base: "main" }, state: "pending" }, ctx.now());
  current = writer.commit(draftCreated(current, ctx, "d-1"));
  drafts.setState("d-1", "executed", ctx.now());
  drafts.setResult("d-1", PR, ctx.now());
  current = writer.commit(draftExecuted(current, ctx, "d-1", PR, { ...PR }));
  if (!opts.checking) writer.commit(ciPassed(current, ctx, { checks: 1 }));

  const gh = fakeExec({
    "gh pr view": () => (opts.ghFails ? fail("HTTP 502") : ok(opts.prView?.() ?? fixture("gh/pr-view-merged.json"))),
  });
  // Reviews come from `gh api graphql` (D39), kept apart so `gh.calls` counts `gh pr view`.
  const api = fakeExec({ "gh api graphql": () => ok(opts.feedback?.() ?? fixture("gh/pr-feedback-bots.json")) });
  const exec: Exec = (cmd, args, o) =>
    cmd === "gh" ? (args[0] === "api" ? api(cmd, args, o) : gh(cmd, args, o)) : realExec(cmd, args, o);
  const deps = {
    items, events, drafts, repos, writer, exec, providers: githubProviders(exec), ctx, log: silentLog,
    removeOnMerge: () => opts.removeOnMerge, agentActive: () => false,
  };
  const types = () => events.forItem(item.id).map((e) => e.type).slice(opts.checking ? 4 : 5);
  return { deps, gh, api, clone, worktree, items, events, types, ctx, writer, item: () => items.get(item.id)!.item };
}

describe("watchPrs: merged PRs", () => {
  it("removes a clean worktree once the PR is merged, keeping the branch", async () => {
    let view = fixture("gh/pr-view-open.json");
    const t = await setup({ removeOnMerge: true, prView: () => view });
    await writeFile(join(t.worktree, ".env.local"), "SECRET=1\n");

    await watchPrs(t.deps);
    expect(t.types()).toEqual([]);
    expect(existsSync(t.worktree)).toBe(true);

    view = fixture("gh/pr-view-merged.json");
    await watchPrs(t.deps);
    expect(t.gh.calls.map((c) => c.args.join(" "))).toEqual([
      "pr view 45 --repo github.com/acme/widgets --json state,mergedAt,mergeable,baseRefName",
      "pr view 45 --repo github.com/acme/widgets --json state,mergedAt,mergeable,baseRefName",
    ]);
    expect(existsSync(t.worktree)).toBe(false);
    expect(git(t.clone, "branch", "--list", "dp/45-fix")).toContain("dp/45-fix");
    expect(t.item()).toMatchObject({ state: "done" });
    expect(t.item().worktreePath).toBeUndefined();
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "worktree.removed", actor: "system",
      payload: { reason: "pr_merged", number: 45, url: PR.url, path: t.worktree, branch: "dp/45-fix" },
    });

    await watchPrs(t.deps);
    expect(t.gh.calls).toHaveLength(2);
  });

  it("keeps a worktree with uncommitted changes and says why once", async () => {
    const t = await setup({ removeOnMerge: true });
    await writeFile(join(t.worktree, "notes.md"), "draft\n");

    await watchPrs(t.deps);
    await watchPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(true);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.remove_skipped"]);
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      actor: "system", payload: { reason: "uncommitted changes", files: ["notes.md"], number: 45 },
    });
    // Known merged: GitHub is asked once.
    expect(t.gh.calls).toHaveLength(1);

    git(t.worktree, "add", "-A");
    git(t.worktree, "commit", "-q", "-m", "notes");
    await watchPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(false);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.remove_skipped", "worktree.removed"]);
  });

  it("only records the merge when the setting is off", async () => {
    const t = await setup({ removeOnMerge: false });
    await watchPrs(t.deps);
    await watchPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(true);
    expect(t.item().worktreePath).toBe(t.worktree);
    expect(t.types()).toEqual(["item.pr_merged"]);
    expect(t.gh.calls).toHaveLength(1);
  });

  it("removes a worktree whose merge it already recorded once the user turns the setting on", async () => {
    const t = await setup({ removeOnMerge: false });
    await watchPrs(t.deps);
    await watchPrs({ ...t.deps, removeOnMerge: () => true });
    expect(existsSync(t.worktree)).toBe(false);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.removed"]);
    expect(t.gh.calls).toHaveLength(1);
  });

  it("leaves everything alone when gh fails or the agent runs", async () => {
    const failing = await setup({ removeOnMerge: true, ghFails: true });
    await watchPrs(failing.deps);
    expect(failing.types()).toEqual([]);
    expect(existsSync(failing.worktree)).toBe(true);

    const running = await setup({ removeOnMerge: true });
    await watchPrs({ ...running.deps, agentActive: () => true });
    expect(existsSync(running.worktree)).toBe(true);
    expect(running.types()).toEqual(["item.pr_merged"]);
  });
});

describe("watchPrs: conflicts", () => {
  /** The branch and `main` both change README.md, so the PR conflicts for real. */
  function conflict(t: Awaited<ReturnType<typeof setup>>) {
    writeFileSync(join(t.worktree, "README.md"), "branch\n");
    git(t.worktree, "commit", "-q", "-am", "branch");
    writeFileSync(join(t.clone, "README.md"), "main\n");
    git(t.clone, "commit", "-q", "-am", "main");
    git(t.clone, "push", "-q", "origin", "main");
  }

  it("brings a done item back with the conflicting files once, and returns it when GitHub reports it mergeable", async () => {
    let view = fixture("gh/pr-view-conflicting.json");
    const t = await setup({ removeOnMerge: true, prView: () => view });
    conflict(t);

    await watchPrs(t.deps);
    await watchPrs(t.deps);
    expect(t.item().state).toBe("needs_you");
    expect(t.types()).toEqual(["pr.conflicted"]);
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      actor: "system", payload: { number: 45, url: PR.url, base: "main", files: ["README.md"], from: "done" },
    });

    view = fixture("gh/pr-view-unknown.json");
    await watchPrs(t.deps);
    expect(t.item().state).toBe("needs_you");

    view = fixture("gh/pr-view-open.json");
    await watchPrs(t.deps);
    expect(t.item().state).toBe("done");
    expect(t.types()).toEqual(["pr.conflicted", "pr.conflict_resolved"]);
    // The worktree stays: the PR is open, not merged.
    expect(existsSync(t.worktree)).toBe(true);
  });

  it("brings a CI-waiting item back and returns it to the CI wait", async () => {
    let view = fixture("gh/pr-view-conflicting.json");
    const t = await setup({ removeOnMerge: false, prView: () => view, checking: true });
    await watchPrs(t.deps);
    expect(t.item().state).toBe("needs_you");
    expect(prConflictOf(t.events.forItem("item-1"))).toMatchObject({ from: "checking", waiting: true, files: [] });

    view = fixture("gh/pr-view-open.json");
    await watchPrs(t.deps);
    expect(t.item().state).toBe("checking");
  });

  it("after I'll do it myself, keeps the item where it was and clears the note once resolved", async () => {
    let view = fixture("gh/pr-view-conflicting.json");
    const t = await setup({ removeOnMerge: false, prView: () => view });
    await watchPrs(t.deps);
    t.writer.commit(prConflictDismissed(t.item(), t.ctx, prConflictOf(t.events.forItem("item-1"))!));
    expect(t.item().state).toBe("done");

    await watchPrs(t.deps);
    expect(t.types()).toEqual(["pr.conflicted", "pr.conflict_dismissed"]);

    view = fixture("gh/pr-view-merged.json");
    await watchPrs(t.deps);
    expect(t.item().state).toBe("done");
    expect(t.types()).toEqual(["pr.conflicted", "pr.conflict_dismissed", "pr.conflict_resolved", "item.pr_merged"]);
    expect(prConflictOf(t.events.forItem("item-1"))).toBeUndefined();
  });

  it("keeps asking about a conflict after the user removed the worktree", async () => {
    let view = fixture("gh/pr-view-conflicting.json");
    const t = await setup({ removeOnMerge: false, prView: () => view });
    await watchPrs(t.deps);
    t.writer.commit(prConflictDismissed(t.item(), t.ctx, prConflictOf(t.events.forItem("item-1"))!));
    const { worktreePath: _, ...rest } = t.item();
    t.writer.save(rest);

    view = fixture("gh/pr-view-open.json");
    await watchPrs(t.deps);
    expect(t.types()).toEqual(["pr.conflicted", "pr.conflict_dismissed", "pr.conflict_resolved"]);
    // Resolved, done and without a worktree: asked until the merge is recorded (D37), then no more.
    view = fixture("gh/pr-view-merged.json");
    await watchPrs(t.deps);
    expect(t.types()).toEqual(["pr.conflicted", "pr.conflict_dismissed", "pr.conflict_resolved", "item.pr_merged"]);
    await watchPrs(t.deps);
    expect(t.gh.calls).toHaveLength(3);
  });

  it("records the merge of a done item whose worktree the user removed before it (D37)", async () => {
    let view = fixture("gh/pr-view-open.json");
    const t = await setup({ removeOnMerge: true, prView: () => view });
    const { worktreePath: _, ...rest } = t.item();
    t.writer.save(rest);

    await watchPrs(t.deps);
    expect(t.types()).toEqual([]);
    view = fixture("gh/pr-view-merged.json");
    await watchPrs(t.deps);
    await watchPrs(t.deps);
    expect(t.types()).toEqual(["item.pr_merged"]);
    expect(t.gh.calls).toHaveLength(2);
  });
});

describe("watchPrs: review feedback", () => {
  it("brings a done item with an open PR back once per new feedback, without the bots", async () => {
    let feedback = fixture("gh/pr-feedback-bots.json");
    const t = await setup({ removeOnMerge: false, prView: () => fixture("gh/pr-view-open.json"), feedback: () => feedback });
    await watchPrs(t.deps);
    expect(t.types()).toEqual([]);
    expect(t.api.calls[0]?.args.slice(0, 10).join(" ")).toBe("api graphql --hostname github.com -F owner=acme -F name=widgets -F number=45");

    feedback = fixture("gh/pr-feedback.json");
    await watchPrs(t.deps);
    expect(t.item().state).toBe("needs_you");
    expect(t.types()).toEqual(["pr.feedback"]);
    const fb = prFeedbackOf(t.events.forItem("item-1"))!;
    expect(fb).toMatchObject({ pr: { number: 45, url: PR.url }, waiting: true });
    expect(fb.entries.map((e) => e.kind)).toEqual(["inline", "review"]);

    // Waiting on the user: no more review calls until the item is done again.
    await watchPrs(t.deps);
    expect(t.api.calls).toHaveLength(2);
    t.writer.commit(prFeedbackDismissed(t.item(), t.ctx, fb));
    await watchPrs(t.deps);
    expect(t.item().state).toBe("done");
    expect(t.types()).toEqual(["pr.feedback", "pr.feedback_dismissed"]);
  });

  it("asks only about open PRs of done items", async () => {
    const checking = await setup({ removeOnMerge: false, prView: () => fixture("gh/pr-view-open.json"), checking: true, feedback: () => fixture("gh/pr-feedback.json") });
    await watchPrs(checking.deps);
    expect(checking.api.calls).toHaveLength(0);

    const merged = await setup({ removeOnMerge: false, feedback: () => fixture("gh/pr-feedback.json") });
    await watchPrs(merged.deps);
    expect(merged.api.calls).toHaveLength(0);
    expect(merged.types()).toEqual(["item.pr_merged"]);
  });

  it("changes nothing when reading the reviews fails", async () => {
    const t = await setup({ removeOnMerge: false, prView: () => fixture("gh/pr-view-open.json"), feedback: () => "not json" });
    await watchPrs(t.deps);
    expect(t.types()).toEqual([]);
    expect(t.item().state).toBe("done");
  });
});
