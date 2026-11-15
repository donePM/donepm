import type { PrStatus, WorkItem } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, ok, type FakeCall } from "../test-support/fake-exec.js";
import { updatePrBranch } from "./update-branch.js";

const BEHIND: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", mergeState: "BEHIND", base: "main" };

function setup(over: Partial<WorkItem> = {}, routes: Parameters<typeof fakeExec>[0] = {}) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const exec = fakeExec({
    "gh pr comment": ok("https://github.com/acme/widgets/pull/88#issuecomment-1\n"),
    "gh pr update-branch": ok("✓ PR branch updated\n"),
    ...routes,
  });
  const item: WorkItem = {
    id: "item-1", source: "github-pr", externalId: "acme/widgets#88", externalUrl: "https://github.com/acme/widgets/pull/88",
    title: "Add a flag", body: "", labels: [], state: "ready", playbook: "review", priority: 2, author: "octocat",
    stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), prStatus: BEHIND, ...over,
  };
  items.insert(item, "github.com/acme/widgets");
  return { deps: { items, events, writer, ctx, providers: githubProviders(exec) }, exec, events };
}

const line = (c: FakeCall) => [c.cmd, ...c.args].join(" ");

describe("updatePrBranch (issue #148)", () => {
  it("merges the base into a behind branch with gh pr update-branch and records it", async () => {
    const t = setup();
    const item = await updatePrBranch(t.deps, "item-1");
    expect(t.exec.calls.map(line)).toEqual(["gh pr update-branch 88 --repo github.com/acme/widgets"]);
    expect(item.state).toBe("ready");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "pr.branch_updated", actor: "user", payload: { via: "update-branch" } });
  });

  it("asks Dependabot to rebase its own pull request instead", async () => {
    const t = setup({ author: "dependabot[bot]" });
    await updatePrBranch(t.deps, "item-1");
    const call = t.exec.calls[0]!;
    expect([call.cmd, ...call.args.slice(0, 5)]).toEqual(["gh", "pr", "comment", "88", "--repo", "github.com/acme/widgets"]);
    expect(t.exec.calls.map(line).some((l) => l.includes("update-branch"))).toBe(false);
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "pr.branch_updated", payload: { via: "dependabot" } });
  });

  it("refuses an unknown item and a branch that is not behind without calling gh", async () => {
    await expect(updatePrBranch(setup().deps, "nope")).rejects.toMatchObject({ status: 404 });
    const clean = setup({ prStatus: { ...BEHIND, mergeState: "CLEAN" } });
    await expect(updatePrBranch(clean.deps, "item-1")).rejects.toMatchObject({ status: 409, message: "cannot update the branch: the branch is not behind main" });
    const merged = setup({ prStatus: { ...BEHIND, state: "MERGED" } });
    await expect(updatePrBranch(merged.deps, "item-1")).rejects.toMatchObject({ status: 409 });
    expect([...clean.exec.calls, ...merged.exec.calls]).toEqual([]);
  });

  it("records nothing when gh fails", async () => {
    const t = setup({}, { "gh pr update-branch": fail("HTTP 422: merge conflict") });
    await expect(updatePrBranch(t.deps, "item-1")).rejects.toMatchObject({ status: 502, message: "HTTP 422: merge conflict" });
    expect(t.events.forItem("item-1").map((e) => e.type)).not.toContain("pr.branch_updated");
  });
});
