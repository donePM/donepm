import type { PrStatus, WorkItem } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { testCtx } from "../test-support/ctx.js";
import { silentLog } from "../log.js";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { autoMergeReady, mergeDefaults, mergePr, setAutoMerge } from "./merge.js";

const READY: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", mergeState: "CLEAN", head: "abc", base: "main", viewerReview: "APPROVED", checks: "SUCCESS" };
const ORIGIN = "github.com/acme/widgets";

function setup(patch: Partial<WorkItem> = {}, exec = fakeExec({ "gh pr merge": ok("") })) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const item: WorkItem = {
    id: "item-1", source: "github-pr", externalId: "acme/widgets#88", externalUrl: "https://github.com/acme/widgets/pull/88",
    title: "Bump vite", body: "", labels: [], state: "done", playbook: "review", priority: 2, author: "dependabot[bot]",
    prStatus: READY, stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), ...patch,
  };
  items.insert(item, ORIGIN);
  const commands = () => exec.calls.map((c) => [c.cmd, ...c.args].join(" "));
  return { deps: { items, events, writer, ctx, providers: githubProviders(exec), log: silentLog }, exec, commands, item: () => items.get("item-1")!.item, last: () => events.forItem("item-1").at(-1) };
}

describe("mergePr (D47)", () => {
  it("merges with gh as the user, leaves the author's branch alone and records it", async () => {
    const t = setup();
    const item = await mergePr(t.deps, "item-1", "rebase");
    expect(t.commands()).toEqual(["gh pr merge 88 --repo github.com/acme/widgets --rebase"]);
    expect(item).toMatchObject({ state: "done", prStatus: { state: "MERGED", closedAt: t.deps.ctx.now() } });
    expect(t.last()).toMatchObject({ type: "pr.merged", actor: "user", payload: { method: "rebase", auto: false } });
  });

  it("refuses without calling gh while something blocks the merge", async () => {
    const t = setup({ prStatus: { ...READY, viewerReview: "COMMENTED", checks: "FAILURE" } });
    await expect(mergePr(t.deps, "item-1", "squash")).rejects.toMatchObject({ status: 409, message: "cannot merge yet: you have not approved it, checks have not passed" });
    await expect(mergePr(t.deps, "nope", "squash")).rejects.toMatchObject({ status: 404 });
    await expect(mergePr(setup({ source: "github-issue" }).deps, "item-1", "squash")).rejects.toMatchObject({ status: 409 });
    expect(t.exec.calls).toEqual([]);
  });

  it("reports gh's refusal and records nothing", async () => {
    const t = setup({}, fakeExec({ "gh pr merge": fail("GraphQL: Base branch was modified") }));
    await expect(mergePr(t.deps, "item-1", "squash")).rejects.toMatchObject({ status: 502, message: "GraphQL: Base branch was modified" });
    expect(t.item().prStatus?.state).toBe("OPEN");
    expect(t.last()).toBeUndefined();
  });
});

describe("setAutoMerge (D47)", () => {
  it("stores the item's choice", () => {
    const t = setup();
    expect(setAutoMerge(t.deps, "item-1", true).autoMerge).toBe(true);
    expect(t.item().autoMerge).toBe(true);
    expect(t.last()).toMatchObject({ type: "pr.auto_merge_set", actor: "user", payload: { on: true } });
    expect(() => setAutoMerge(setup({ source: "github-issue" }).deps, "item-1", true)).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("mergeDefaults", () => {
  it("is off and squash unless the repository says otherwise", () => {
    expect(mergeDefaults({}, ORIGIN)).toEqual({ auto: false, method: "squash" });
    expect(mergeDefaults({ [ORIGIN]: { assignOnStart: false, autoMerge: true, mergeMethod: "merge" } }, ORIGIN)).toEqual({ auto: true, method: "merge" });
  });
});

describe("autoMergeReady (D47)", () => {
  const managed = () => true;

  it("merges a ready pull request whose repository turned auto-merge on, with its method", async () => {
    const t = setup();
    await autoMergeReady(t.deps, { [ORIGIN]: { assignOnStart: false, autoMerge: true, mergeMethod: "merge" } }, managed);
    expect(t.commands()).toEqual(["gh pr merge 88 --repo github.com/acme/widgets --merge"]);
    expect(t.last()).toMatchObject({ type: "pr.merged", actor: "system", payload: { method: "merge", auto: true } });
  });

  it("follows the item's own choice over the repository's", async () => {
    const off = setup({ autoMerge: false });
    await autoMergeReady(off.deps, { [ORIGIN]: { assignOnStart: false, autoMerge: true } }, managed);
    expect(off.exec.calls).toEqual([]);
    const on = setup({ autoMerge: true });
    await autoMergeReady(on.deps, {}, managed);
    expect(on.commands()).toEqual(["gh pr merge 88 --repo github.com/acme/widgets --squash"]);
  });

  it("leaves blocked, merged and unmanaged pull requests alone", async () => {
    for (const patch of [{ prStatus: { ...READY, checks: "PENDING" } }, { prStatus: { ...READY, mergeState: "BEHIND" } }, { prStatus: { ...READY, state: "MERGED" } }, { state: "running" as const }]) {
      const t = setup({ autoMerge: true, ...patch });
      await autoMergeReady(t.deps, {}, managed);
      expect(t.exec.calls).toEqual([]);
    }
    const t = setup({ autoMerge: true });
    await autoMergeReady(t.deps, {}, () => false);
    expect(t.exec.calls).toEqual([]);
  });

  it("turns auto-merge off for the item when gh refuses, so it is not tried again", async () => {
    const t = setup({ autoMerge: true }, fakeExec({ "gh pr merge": fail("Pull request is in clean status, merge queue required") }));
    await autoMergeReady(t.deps, {}, managed);
    expect(t.item().autoMerge).toBe(false);
    expect(t.last()).toMatchObject({ type: "pr.merge_failed", actor: "system", payload: { method: "squash", auto: true, error: "Pull request is in clean status, merge queue required" } });
    await autoMergeReady(t.deps, {}, managed);
    expect(t.exec.calls).toHaveLength(1);
  });

  it("keeps auto-merge on when the branch was behind its base, and tries again once the pull request changed", async () => {
    const behind = "X Pull request acme/widgets#88 is not mergeable: the head branch is not up to date with the base branch.";
    let answer = fail(behind);
    const t = setup({ autoMerge: true }, fakeExec({ "gh pr merge": () => answer }));
    await autoMergeReady(t.deps, {}, managed);
    expect(t.item()).toMatchObject({ autoMerge: true, autoMergeHeld: { head: "abc", mergeState: "CLEAN" } });
    expect(t.last()).toMatchObject({ type: "pr.merge_failed", payload: { auto: true, staysOn: true, error: behind } });

    // Same head, same merge state: not tried again.
    await autoMergeReady(t.deps, {}, managed);
    expect(t.exec.calls).toHaveLength(1);

    // Behind: blocked. Rebased onto the base and clean again: merged.
    t.deps.items.update({ ...t.item(), prStatus: { ...READY, mergeState: "BEHIND" } });
    await autoMergeReady(t.deps, {}, managed);
    expect(t.exec.calls).toHaveLength(1);
    t.deps.items.update({ ...t.item(), prStatus: { ...READY, head: "def" } });
    answer = ok("");
    await autoMergeReady(t.deps, {}, managed);
    expect(t.exec.calls).toHaveLength(2);
    expect(t.last()).toMatchObject({ type: "pr.merged", actor: "system", payload: { auto: true } });
  });
});
