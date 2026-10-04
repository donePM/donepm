import type { WorkItem } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { commentOnPr } from "./comment.js";

function setup(source: WorkItem["source"] = "github-pr", exec = fakeExec({ "gh pr comment": ok("https://github.com/acme/widgets/pull/88#issuecomment-1\n") })) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const item: WorkItem = {
    id: "item-1", source, externalId: "acme/widgets#88", externalUrl: "https://github.com/acme/widgets/pull/88",
    title: "Bump vite", body: "", labels: [], state: "done", playbook: "review", priority: 2, author: "dependabot[bot]",
    stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(),
  };
  items.insert(item, "github.com/acme/widgets");
  return { deps: { items, events, writer, ctx, providers: githubProviders(exec) }, exec, events };
}

describe("commentOnPr (D47)", () => {
  it("posts the comment with gh as the user and records it", async () => {
    const t = setup();
    const item = await commentOnPr(t.deps, "item-1", "  @dependabot rebase\n");
    const call = t.exec.calls[0]!;
    expect([call.cmd, ...call.args.slice(0, 5)]).toEqual(["gh", "pr", "comment", "88", "--repo", "github.com/acme/widgets"]);
    expect(item.state).toBe("done");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({ type: "pr.commented", actor: "user", payload: { body: "@dependabot rebase" } });
  });

  it("refuses an unknown item, an issue and an empty comment without calling gh", async () => {
    await expect(commentOnPr(setup().deps, "nope", "x")).rejects.toMatchObject({ status: 404 });
    const issue = setup("github-issue");
    await expect(commentOnPr(issue.deps, "item-1", "x")).rejects.toMatchObject({ status: 409 });
    const empty = setup();
    await expect(commentOnPr(empty.deps, "item-1", "  ")).rejects.toMatchObject({ status: 409 });
    expect([...issue.exec.calls, ...empty.exec.calls]).toEqual([]);
  });

  it("records nothing when gh fails", async () => {
    const t = setup("github-pr", fakeExec({ "gh pr comment": fail("HTTP 403") }));
    await expect(commentOnPr(t.deps, "item-1", "x")).rejects.toMatchObject({ status: 502, message: "HTTP 403" });
    expect(t.events.forItem("item-1").map((e) => e.type)).not.toContain("pr.commented");
  });
});
