import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { exec } from "../process/exec.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { moveWorktrees, worktreesUnder } from "./move.js";

/** A real clone with worktrees under `<tmp>/old`, and items pointing at them. */
async function setup() {
  const base = realpathSync(await mkdtemp(join(tmpdir(), "donepm-move-")));
  const { clone } = await cloneWithOrigin({}, base);
  const oldRoot = join(base, "old");
  const newRoot = join(base, "new");
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  repos.upsert({ id: "repo-1", path: clone, originUrl: "github.com/acme/widgets", defaultBranch: "main" }, ctx.now());
  const running = new Set<string>();

  const add = (n: number, over: Partial<WorkItem> = {}, worktree = true) => {
    const branch = `dp/${n}-fix`;
    const path = join(oldRoot, "acme-widgets", `dp-${n}-fix`);
    if (worktree) git(clone, "worktree", "add", "-q", "-b", branch, path, "main");
    const item: WorkItem = {
      id: `item-${n}`, source: "github-issue", externalId: `acme/widgets#${n}`, externalUrl: `https://github.com/acme/widgets/issues/${n}`,
      repoId: "repo-1", title: `Fix ${n}`, body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
      stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), agentSessionId: `s${n}`, worktreePath: path, branch, ...over,
    };
    items.insert(item, "github.com/acme/widgets");
    return path;
  };

  const deps = { items, repos, writer, ctx, exec, log: silentLog, agentActive: (id: string) => running.has(id) };
  return { deps, add, clone, oldRoot, newRoot, running, items, events };
}

describe("moveWorktrees (#93)", () => {
  it("moves each worktree with git, keeps the session, and records the move", async () => {
    const t = await setup();
    const from = t.add(1);
    // A review worktree (D41) lives under the same root and moves alike.
    const review = t.add(2, { source: "github-pr", playbook: "review", externalId: "acme/widgets#2" });
    expect(worktreesUnder(t.deps, t.oldRoot).map((w) => w.itemId)).toEqual(["item-1", "item-2"]);

    const out = await moveWorktrees(t.deps, t.oldRoot, t.newRoot);

    const to = join(t.newRoot, "acme-widgets", "dp-1-fix");
    expect(out.skipped).toEqual([]);
    expect(out.moved).toEqual([
      { itemId: "item-1", title: "Fix 1", from, to },
      { itemId: "item-2", title: "Fix 2", from: review, to: join(t.newRoot, "acme-widgets", "dp-2-fix") },
    ]);
    expect(existsSync(from)).toBe(false);
    expect(git(t.clone, "worktree", "list", "--porcelain")).toContain(`worktree ${to}\n`);
    expect(git(to, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("dp/1-fix");
    const item = t.items.get("item-1")!.item;
    expect(item).toMatchObject({ worktreePath: to, agentSessionId: "s1", state: "ready" });
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "worktree.moved", actor: "user", payload: { from, to } });
    expect(worktreesUnder(t.deps, t.oldRoot)).toEqual([]);
  });

  it("skips a running agent, a missing worktree and an occupied target, with reasons", async () => {
    const t = await setup();
    const busy = t.add(1);
    const missing = t.add(2, {}, false);
    const blocked = t.add(3);
    await mkdir(join(t.newRoot, "acme-widgets", "dp-3-fix"), { recursive: true });
    t.running.add("item-1");
    expect(worktreesUnder(t.deps, t.oldRoot).find((w) => w.itemId === "item-1")?.running).toBe(true);

    const out = await moveWorktrees(t.deps, t.oldRoot, t.newRoot);

    expect(out.moved).toEqual([]);
    expect(out.skipped).toEqual([
      { itemId: "item-1", title: "Fix 1", path: busy, reason: "its agent is running" },
      { itemId: "item-2", title: "Fix 2", path: missing, reason: "the worktree is missing" },
      { itemId: "item-3", title: "Fix 3", path: blocked, reason: `${join(t.newRoot, "acme-widgets", "dp-3-fix")} already exists` },
    ]);
    expect(existsSync(busy) && existsSync(blocked)).toBe(true);
    expect(t.items.get("item-1")!.item.worktreePath).toBe(busy);
    expect(t.events.forItem("item-1").some((e) => e.type === "worktree.moved")).toBe(false);
  });

  it("reports git's error and leaves the item as it was", async () => {
    const t = await setup();
    const path = t.add(1);
    // A locked worktree refuses to move.
    git(t.clone, "worktree", "lock", path);
    const out = await moveWorktrees(t.deps, t.oldRoot, t.newRoot);
    expect(out.moved).toEqual([]);
    expect(out.skipped).toEqual([{ itemId: "item-1", title: "Fix 1", path, reason: expect.stringContaining("locked") }]);
    expect(t.items.get("item-1")!.item.worktreePath).toBe(path);
  });
});
