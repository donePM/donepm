import { draftCreated, draftExecuted, start, type Ctx, type WorkItem } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import type { ExecResult } from "../process/exec.js";
import { watchCi } from "./watch.js";

const PR = { url: "https://github.com/donePM/donepm/pull/62", number: 62 };
const T0 = "2026-10-03T19:47:00.000Z";

/** An item whose PR draft was just executed, so it waits for CI since T0; gh answers `checks`. */
function setup(checks: () => ExecResult) {
  const db = openDb(":memory:");
  let now = T0;
  let n = 0;
  const ctx: Ctx = { now: () => now, newId: () => `id-${++n}` };
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "donePM/donepm#62", externalUrl: "https://github.com/donePM/donepm/issues/62",
    title: "CI", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: now, createdAt: now, updatedAt: now,
  };
  items.insert(item, "github.com/donePM/donepm");
  let current = writer.commit(start(item, ctx));
  current = writer.commit(draftCreated(current, ctx, "d-1"));
  writer.commit(draftExecuted(current, ctx, "d-1", PR, { ...PR }));
  const exec = fakeExec({
    "gh pr checks 62": checks,
    "gh run view 37149187747 --repo github.com/donePM/donepm --log-failed": ok(fixture("gh/run-view-log-failed.txt")),
  });
  const deps = { items, events, writer, providers: githubProviders(exec), ctx, log: silentLog };
  return {
    deps,
    exec,
    at: (t: string) => (now = t),
    item: () => items.get(item.id)!.item,
    last: () => events.forItem(item.id).at(-1)!,
  };
}

describe("watchCi", () => {
  it("leaves the item waiting while checks are pending", async () => {
    const t = setup(() => ({ code: 8, stdout: fixture("gh/pr-checks-pending.json"), stderr: "" }));
    t.at("2026-10-03T19:55:00Z");
    const seen: Array<{ itemId: string; buckets: string[] }> = [];
    await watchCi({ ...t.deps, onChecks: (itemId, checks) => seen.push({ itemId, buckets: checks.map((c) => c.bucket) }) });
    expect(t.item().state).toBe("checking");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.itemId).toBe(t.item().id);
    expect(seen[0]!.buckets).toContain("pending");
  });

  it("moves the item to Done when all checks passed", async () => {
    const t = setup(() => ok(fixture("gh/pr-checks-pass.json")));
    await watchCi(t.deps);
    expect(t.item().state).toBe("done");
    expect(t.last()).toMatchObject({ type: "ci.passed", payload: { ...PR, checks: 4 } });
  });

  it("moves the item to Needs you with the failed checks and their log ends", async () => {
    const t = setup(() => ({ code: 1, stdout: fixture("gh/pr-checks-fail.json"), stderr: "" }));
    t.at("2026-10-03T19:51:00Z");
    await watchCi(t.deps);
    expect(t.item().state).toBe("needs_you");
    const e = t.last();
    expect(e.type).toBe("ci.failed");
    expect((e.payload.failed as any[]).map((c) => c.name)).toEqual(["test (ubuntu-latest, node 24)", "test (ubuntu-latest, node 22)"]);
    expect((e.payload.logs as any[]).map((l) => l.name)).toEqual(["test (ubuntu-latest, node 24)", "test (ubuntu-latest, node 22)"]);
    // One run holds both failed jobs: its log is fetched once.
    expect(t.exec.calls.filter((c) => c.args[0] === "run")).toHaveLength(1);
  });

  it("waits out the grace period for checks to appear, then counts no checks as passed", async () => {
    const t = setup(() => fail(fixture("gh/pr-checks-none.stderr")));
    t.at("2026-10-03T19:47:30.000Z");
    await watchCi(t.deps);
    expect(t.item().state).toBe("checking");
    t.at("2026-10-03T19:48:01.000Z");
    await watchCi(t.deps);
    expect(t.item()).toMatchObject({ state: "done" });
    expect(t.last().payload).toMatchObject({ checks: 0 });
  });

  it("keeps waiting when gh fails", async () => {
    const t = setup(() => fail("HTTP 502"));
    t.at("2026-10-03T20:00:00Z");
    await watchCi(t.deps);
    expect(t.item().state).toBe("checking");
  });
});
