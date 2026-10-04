import { draftCreated, draftExecuted, prConflicted, start, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { dismissConflict, resolveConflict } from "./actions.js";

const PR = { url: "https://github.com/acme/widgets/pull/45", number: 45 };

/** An item waiting for CI; `conflicting` lets its PR conflict with `main`. */
function setup(conflicting = true, exec = fakeExec({ "git -C /src/widgets fetch": ok("") })) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  repos.upsert({ id: "repo-1", path: "/src/widgets", originUrl: "github.com/acme/widgets", defaultBranch: "main" }, ctx.now());
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "acme/widgets#45", externalUrl: "https://github.com/acme/widgets/issues/45",
    repoId: "repo-1", title: "Fix", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), agentSessionId: "s1", worktreePath: "/wt/45", branch: "dp/45-fix",
  };
  items.insert(item, "github.com/acme/widgets");
  let current = writer.commit(start(item, ctx));
  current = writer.commit(draftCreated(current, ctx, "d-1"));
  current = writer.commit(draftExecuted(current, ctx, "d-1", PR, { ...PR }));
  if (conflicting) writer.commit(prConflicted(current, ctx, { ...PR, base: "main", files: ["src/index.ts"] }));
  return { deps: { items, events, repos, writer, ctx, exec }, exec, item: () => items.get(item.id)!.item, last: () => events.forItem(item.id).at(-1)! };
}

describe("resolveConflict", () => {
  it("fetches the base, then resumes the agent with the conflict as the message", async () => {
    const t = setup();
    const resumed: Array<{ itemId: string; prompt: string; state: string }> = [];
    await resolveConflict({ ...t.deps, resume: async (itemId, how) => {
      const { item } = how.transition(t.item(), t.deps.ctx);
      resumed.push({ itemId, prompt: how.prompt, state: item.state });
    } }, "item-1");
    expect(t.exec.calls.map((c) => [c.cmd, ...c.args].join(" "))).toEqual(["git -C /src/widgets fetch origin main"]);
    expect(resumed).toEqual([{ itemId: "item-1", prompt: expect.stringContaining("- src/index.ts"), state: "running" }]);
    expect(resumed[0]!.prompt).toContain("git merge origin/main");
  });

  it("refuses without a waiting conflict, and when the fetch fails", async () => {
    const resume = async () => {};
    await expect(resolveConflict({ ...setup(false).deps, resume }, "item-1")).rejects.toMatchObject({ status: 409 });
    await expect(resolveConflict({ ...setup().deps, resume }, "nope")).rejects.toMatchObject({ status: 404 });
    const t = setup(true, fakeExec({ "git -C /src/widgets fetch": fail("fatal: unable to access") }));
    await expect(resolveConflict({ ...t.deps, resume }, "item-1")).rejects.toMatchObject({ status: 502, message: "fatal: unable to access" });
  });
});

describe("dismissConflict", () => {
  it("returns the item to where it was and records the user's choice", () => {
    const t = setup();
    expect(dismissConflict(t.deps, "item-1").state).toBe("checking");
    expect(t.last()).toMatchObject({ type: "pr.conflict_dismissed", actor: "user", payload: PR });
    expect(() => dismissConflict(t.deps, "item-1")).toThrow(expect.objectContaining({ status: 409 }));
  });
});
