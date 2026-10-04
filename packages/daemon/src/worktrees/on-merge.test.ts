import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ciPassed, draftCreated, draftExecuted, start, type WorkItem } from "@donepm/core";
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
import { settleMergedPrs } from "./on-merge.js";

const PR = { url: "https://github.com/acme/widgets/pull/45", number: 45 };

/** A done item whose draft opened PR #45, with a real worktree; gh answers `prView`. */
async function setup(opts: { removeOnMerge: boolean; prView?: () => string; ghFails?: boolean }) {
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
  writer.commit(ciPassed(current, ctx, { checks: 1 }));

  const gh = fakeExec({
    "gh pr view": () => (opts.ghFails ? fail("HTTP 502") : ok(opts.prView?.() ?? fixture("gh/pr-view-merged.json"))),
  });
  const exec: Exec = (cmd, args, o) => (cmd === "gh" ? gh(cmd, args, o) : realExec(cmd, args, o));
  const deps = {
    items, events, drafts, repos, writer, exec, ctx, log: silentLog,
    removeOnMerge: () => opts.removeOnMerge, agentActive: () => false,
  };
  const types = () => events.forItem(item.id).map((e) => e.type).slice(5);
  return { deps, gh, clone, worktree, items, events, types, item: () => items.get(item.id)!.item };
}

describe("settleMergedPrs", () => {
  it("removes a clean worktree once the PR is merged, keeping the branch", async () => {
    let view = fixture("gh/pr-view-open.json");
    const t = await setup({ removeOnMerge: true, prView: () => view });
    await writeFile(join(t.worktree, ".env.local"), "SECRET=1\n");

    await settleMergedPrs(t.deps);
    expect(t.types()).toEqual([]);
    expect(existsSync(t.worktree)).toBe(true);

    view = fixture("gh/pr-view-merged.json");
    await settleMergedPrs(t.deps);
    expect(t.gh.calls.map((c) => c.args.join(" "))).toEqual([
      "pr view 45 --repo github.com/acme/widgets --json state,mergedAt",
      "pr view 45 --repo github.com/acme/widgets --json state,mergedAt",
    ]);
    expect(existsSync(t.worktree)).toBe(false);
    expect(git(t.clone, "branch", "--list", "dp/45-fix")).toContain("dp/45-fix");
    expect(t.item()).toMatchObject({ state: "done" });
    expect(t.item().worktreePath).toBeUndefined();
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "worktree.removed", actor: "system",
      payload: { reason: "pr_merged", number: 45, url: PR.url, path: t.worktree, branch: "dp/45-fix" },
    });

    await settleMergedPrs(t.deps);
    expect(t.gh.calls).toHaveLength(2);
  });

  it("keeps a worktree with uncommitted changes and says why once", async () => {
    const t = await setup({ removeOnMerge: true });
    await writeFile(join(t.worktree, "notes.md"), "draft\n");

    await settleMergedPrs(t.deps);
    await settleMergedPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(true);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.remove_skipped"]);
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      actor: "system", payload: { reason: "uncommitted changes", files: ["notes.md"], number: 45 },
    });
    // Known merged: GitHub is asked once.
    expect(t.gh.calls).toHaveLength(1);

    git(t.worktree, "add", "-A");
    git(t.worktree, "commit", "-q", "-m", "notes");
    await settleMergedPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(false);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.remove_skipped", "worktree.removed"]);
  });

  it("only records the merge when the setting is off", async () => {
    const t = await setup({ removeOnMerge: false });
    await settleMergedPrs(t.deps);
    await settleMergedPrs(t.deps);
    expect(existsSync(t.worktree)).toBe(true);
    expect(t.item().worktreePath).toBe(t.worktree);
    expect(t.types()).toEqual(["item.pr_merged"]);
    expect(t.gh.calls).toHaveLength(1);
  });

  it("removes a worktree whose merge it already recorded once the user turns the setting on", async () => {
    const t = await setup({ removeOnMerge: false });
    await settleMergedPrs(t.deps);
    await settleMergedPrs({ ...t.deps, removeOnMerge: () => true });
    expect(existsSync(t.worktree)).toBe(false);
    expect(t.types()).toEqual(["item.pr_merged", "worktree.removed"]);
    expect(t.gh.calls).toHaveLength(1);
  });

  it("leaves everything alone when gh fails or the agent runs", async () => {
    const failing = await setup({ removeOnMerge: true, ghFails: true });
    await settleMergedPrs(failing.deps);
    expect(failing.types()).toEqual([]);
    expect(existsSync(failing.worktree)).toBe(true);

    const running = await setup({ removeOnMerge: true });
    await settleMergedPrs({ ...running.deps, agentActive: () => true });
    expect(existsSync(running.worktree)).toBe(true);
    expect(running.types()).toEqual(["item.pr_merged"]);
  });
});
