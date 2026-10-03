import type { WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { ItemStore } from "../items/store.js";
import { silentLog, type Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { RepoStore } from "../repos/store.js";
import { StatusStore } from "../status/status.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { collectIssues } from "./collect-issues.js";

const ready = { "which gh": ok("/opt/homebrew/bin/gh\n"), "gh auth status": ok(fixture("gh/auth-status-ok.stdout")) };

function setup(exec: Exec, log: Log = silentLog) {
  const db = openDb(":memory:");
  const pushed: WorkItem[] = [];
  const deps = {
    db, exec, log, ctx: testCtx(),
    items: new ItemStore(db), events: new EventStore(db), repos: new RepoStore(db), status: new StatusStore("0.0.0"),
    onItemUpdated: (i: WorkItem) => pushed.push(i),
  };
  return { deps, pushed };
}

describe("collectIssues", () => {
  it("detects gh, stores recorded issues and pushes them", async () => {
    const { deps, pushed } = setup(fakeExec({ ...ready, "gh search issues": ok(fixture("gh/search-issues.json")) }));
    await collectIssues(deps);
    expect(deps.items.all()).toHaveLength(4);
    expect(pushed).toHaveLength(4);
    expect(deps.status.get().gh?.state).toBe("ready");
    expect(deps.status.get().lastPoll).toEqual({ at: "2026-10-03T12:00:00.000Z", ok: true, issues: 4 });
  });

  it("does not poll when gh is not logged in", async () => {
    const exec = fakeExec({ "which gh": ok("/x/gh"), "gh auth status": fail("not logged in") });
    const { deps } = setup(exec);
    await collectIssues(deps);
    expect(exec.calls.map((c) => c.args[0])).toEqual(["gh", "auth"]);
    expect(deps.status.get().lastPoll).toMatchObject({ ok: false, error: "gh not_logged_in" });
  });

  it("logs raw output on schema failure, keeps items and records the error", async () => {
    const errors: object[] = [];
    const log = { ...silentLog, error: (o: object) => void errors.push(o) };
    let out = fixture("gh/search-issues.json");
    const { deps } = setup(fakeExec({ ...ready, "gh search issues": () => ok(out) }), log);
    await collectIssues(deps);
    out = '[{"oops":true}]';
    await collectIssues(deps);
    expect(deps.items.all()).toHaveLength(4);
    expect(deps.status.get().lastPoll?.ok).toBe(false);
    expect(errors[0]).toMatchObject({ raw: '[{"oops":true}]' });
  });

  it("flags items whose issue was closed upstream", async () => {
    let out = fixture("gh/search-issues.json");
    const exec = fakeExec({
      ...ready,
      "gh search issues": () => ok(out),
      "gh issue view 161": ok(fixture("gh/issue-view-closed.json")),
      "gh issue view": ok(fixture("gh/issue-view-open.json")),
    });
    const { deps, pushed } = setup(exec);
    await collectIssues(deps);
    out = fixture("gh/search-issues-empty.json");
    pushed.length = 0;
    await collectIssues(deps);
    expect(pushed.map((i) => [i.externalId, i.closedUpstream])).toEqual([["acme/widgets#161", true]]);
    expect(deps.items.all()).toHaveLength(4);
  });
});
