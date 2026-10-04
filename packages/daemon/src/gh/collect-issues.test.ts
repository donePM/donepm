import type { WorkItem } from "@donepm/core";
import type { Config } from "../config/config.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { ItemStore } from "../items/store.js";
import { silentLog, type Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { RepoStore } from "../repos/store.js";
import { TombstoneStore } from "../retention/tombstones.js";
import { StatusStore } from "../status/status.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { collectIssues } from "./collect-issues.js";

const ready = {
  "which gh": ok("/opt/homebrew/bin/gh\n"),
  "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
  "gh search prs": ok(fixture("gh/search-prs-empty.json")),
  "gh api graphql": ok(fixture("gh/issue-fields.json")),
};

function setup(exec: Exec, log: Log = silentLog, sources: Config["sources"] = {}) {
  const db = openDb(":memory:");
  const pushed: WorkItem[] = [];
  const deps = {
    db, exec, log, ctx: testCtx(), sources: () => sources,
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

  it("takes the Priority issue field over, records the change and keeps it when the fields fail (D45)", async () => {
    let fields = ok(fixture("gh/issue-fields.json"));
    const { deps, pushed } = setup(fakeExec({ ...ready, "gh search issues": ok(fixture("gh/search-issues.json")), "gh api graphql": () => fields }));
    await collectIssues(deps);
    const priorities = () => Object.fromEntries(deps.items.all().map((s) => [s.item.externalId, s.item.priority]));
    expect(priorities()).toEqual({ "acme/widgets#161": 2, "acme/widgets#157": 3, "solo/tool#61": 2, "Acme/API#12": 2 });

    // The user sets #161 to Urgent on GitHub: one poll later it is P0 and the timeline says so.
    fields = ok(fixture("gh/issue-fields.json").replace('"Medium"', '"Urgent"'));
    pushed.length = 0;
    await collectIssues(deps);
    expect(pushed.map((i) => [i.externalId, i.priority])).toEqual([["acme/widgets#161", 0]]);
    const events = deps.events.forItem(pushed[0]!.id);
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ["item.collected", expect.anything()],
      ["item.refreshed", { changed: { priority: { from: 2, to: 0 } } }],
    ]);

    // A failing lookup changes nothing: no fallback to the labels and back.
    fields = fail("HTTP 502");
    pushed.length = 0;
    await collectIssues(deps);
    expect(pushed).toEqual([]);
    expect(priorities()["acme/widgets#161"]).toBe(0);
    expect(deps.status.get().lastPoll?.ok).toBe(true);
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
    expect(pushed.map((i) => [i.externalId, i.state, i.closedUpstream])).toEqual([["acme/widgets#161", "done", true]]);
    expect(deps.events.forItem(pushed[0]!.id).map((e) => e.type)).toEqual(["item.collected", "item.closed_upstream"]);
    expect(deps.items.all()).toHaveLength(4);
  });

  it("only flags a started item whose issue was closed upstream", async () => {
    let out = fixture("gh/search-issues.json");
    const exec = fakeExec({
      ...ready,
      "gh search issues": () => ok(out),
      "gh issue view 161": ok(fixture("gh/issue-view-closed.json")),
      "gh issue view": ok(fixture("gh/issue-view-open.json")),
    });
    const { deps, pushed } = setup(exec);
    await collectIssues(deps);
    const started = deps.items.byExternalId("acme/widgets#161")!.item;
    deps.items.update({ ...started, worktreePath: "/wt/161" });
    out = fixture("gh/search-issues-empty.json");
    pushed.length = 0;
    await collectIssues(deps);
    expect(pushed.map((i) => [i.externalId, i.state, i.closedUpstream])).toEqual([["acme/widgets#161", "ready", true]]);
    expect(deps.events.forItem(started.id).map((e) => e.type)).toEqual(["item.collected"]);
  });

  it("collects a reopened issue whose archived item was seen closed as a new item (D37)", async () => {
    let out = fixture("gh/search-issues.json");
    const exec = fakeExec({
      ...ready,
      "gh search issues": () => ok(out),
      "gh issue view 161": ok(fixture("gh/issue-view-closed.json")),
      "gh issue view": ok(fixture("gh/issue-view-open.json")),
    });
    const { deps } = setup(exec);
    await collectIssues(deps);
    const old = deps.items.byExternalId("acme/widgets#161")!.item;
    deps.items.update({ ...old, state: "done", archivedAt: "2026-10-03T11:00:00.000Z" });
    await collectIssues(deps);
    expect(deps.items.all()).toHaveLength(4);

    out = fixture("gh/search-issues-empty.json");
    await collectIssues(deps);
    expect(deps.items.get(old.id)!.item.closedUpstream).toBe(true);

    out = fixture("gh/search-issues.json");
    await collectIssues(deps);
    expect(deps.items.all()).toHaveLength(5);
    expect(deps.items.byExternalId("acme/widgets#161")!.item).toMatchObject({ state: "ready" });
    expect(deps.items.byExternalId("acme/widgets#161")!.item.id).not.toBe(old.id);
  });

  it("marks a purged issue's tombstone closed once gh says so (D37)", async () => {
    const exec = fakeExec({
      ...ready,
      "gh search issues": ok(fixture("gh/search-issues-empty.json")),
      "gh issue view 5": ok(fixture("gh/issue-view-closed.json")),
      "gh issue view": ok(fixture("gh/issue-view-open.json")),
    });
    const { deps } = setup(exec);
    const tombstones = new TombstoneStore(deps.db);
    for (const n of [5, 6]) {
      tombstones.put({ externalId: `acme/widgets#${n}`, source: "github-issue", originUrl: "github.com/acme/widgets", closed: false, deletedAt: "t" });
    }
    await collectIssues(deps);
    expect(tombstones.get("acme/widgets#5")?.closed).toBe(true);
    expect(tombstones.get("acme/widgets#6")?.closed).toBe(false);
  });

  it("adds the issues of a repository query to the default search, one item per issue", async () => {
    const queried = JSON.stringify([
      { number: 161, title: "[Feature] Support nested relations", body: "", labels: [], url: "https://github.com/acme/widgets/issues/161", createdAt: "2026-09-01T00:00:00Z" },
      { number: 200, title: "Unassigned bug", body: "", labels: [{ name: "bug" }], url: "https://github.com/acme/widgets/issues/200", createdAt: "2026-09-01T00:00:00Z" },
    ]);
    const exec = fakeExec({
      ...ready,
      "gh search issues": ok(fixture("gh/search-issues.json")),
      "gh issue list --repo github.com/acme/widgets": ok(queried),
    });
    const { deps } = setup(exec, silentLog, {
      "github.com/acme/widgets": { query: "is:issue no:assignee", assignOnStart: false },
      "github.com/solo/tool": { assignOnStart: true },
    });
    await collectIssues(deps);
    expect(deps.items.all().map((s) => s.item.externalId).sort()).toEqual([
      "Acme/API#12", "acme/widgets#157", "acme/widgets#161", "acme/widgets#200", "solo/tool#61",
    ]);
    expect(exec.calls.filter((c) => c.args[0] === "issue" && c.args[1] === "list")).toHaveLength(1);
    expect(deps.status.get().lastPoll).toEqual({
      at: "2026-10-03T12:00:00.000Z", ok: true, issues: 5, sources: { "github.com/acme/widgets": { ok: true, issues: 2 } },
    });
  });

  it("keeps the other sources when one query fails and does not treat its items as missing", async () => {
    let out = fixture("gh/search-issues.json");
    const exec = fakeExec({
      ...ready,
      "gh search issues": () => ok(out),
      "gh issue list --repo github.com/solo/tool": fail("invalid search query"),
    });
    const { deps } = setup(exec, silentLog, { "github.com/solo/tool": { query: "bad(", assignOnStart: false } });
    await collectIssues(deps);
    expect(deps.items.all()).toHaveLength(4);
    out = fixture("gh/search-issues-empty.json");
    await collectIssues(deps);
    expect(exec.calls.some((c) => c.args[1] === "view")).toBe(false);
    expect(deps.status.get().lastPoll).toMatchObject({
      ok: false,
      issues: 0,
      error: "github.com/solo/tool: invalid search query",
      sources: { "github.com/solo/tool": { ok: false, error: "invalid search query" } },
    });
  });

  describe("review requests (D40)", () => {
    it("collects pull requests that ask for the user's review as github-pr items with the review playbook", async () => {
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues-empty.json")),
        "gh search prs": ok(fixture("gh/search-prs.json")),
      });
      const { deps } = setup(exec);
      await collectIssues(deps);
      const rows = deps.items.all().map((s) => [s.item.externalId, s.item.source, s.item.playbook, s.originUrl].join(" "));
      expect(rows.sort()).toEqual([
        "vuejs/core#15757 github-pr review github.com/vuejs/core",
        "vuejs/core#15766 github-pr review github.com/vuejs/core",
      ]);
      expect(exec.calls.find((c) => c.args[1] === "prs")!.args).toContain("--review-requested=@me");
      expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 2 });
    });

    it("keeps the issues and skips missing checks when the review request search fails", async () => {
      let out = fixture("gh/search-issues.json");
      const exec = fakeExec({ ...ready, "gh search issues": () => ok(out), "gh search prs": fail("HTTP 502") });
      const { deps } = setup(exec);
      await collectIssues(deps);
      expect(deps.items.all()).toHaveLength(4);
      out = fixture("gh/search-issues-empty.json");
      await collectIssues(deps);
      expect(exec.calls.some((c) => c.args[1] === "view")).toBe(false);
      expect(deps.status.get().lastPoll).toMatchObject({ ok: false, error: "review requests: HTTP 502" });
    });

    it("treats a gh without search prs as no review requests", async () => {
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues.json")),
        "gh search prs": fail(fixture("gh/search-unknown-command.stderr")),
      });
      const { deps } = setup(exec);
      await collectIssues(deps);
      expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 4 });
    });

    it("drops review requests from an ignored repository", async () => {
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues-empty.json")),
        "gh search prs": ok(fixture("gh/search-prs.json")),
      });
      const { deps } = setup(exec, silentLog, { "github.com/vuejs/core": { assignOnStart: false, ignored: true } });
      await collectIssues(deps);
      expect(deps.items.all()).toHaveLength(0);
    });

    it("finishes an untouched review item once its pull request is merged", async () => {
      let out = fixture("gh/search-prs.json");
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues-empty.json")),
        "gh search prs": () => ok(out),
        "gh issue view 15766": ok(fixture("gh/issue-view-merged-pr.json")),
        "gh issue view": ok(fixture("gh/issue-view-open.json")),
      });
      const { deps } = setup(exec);
      await collectIssues(deps);
      out = fixture("gh/search-prs-empty.json");
      await collectIssues(deps);
      expect(deps.items.byExternalId("vuejs/core#15766")!.item).toMatchObject({ state: "done", closedUpstream: true });
      expect(deps.items.byExternalId("vuejs/core#15757")!.item).toMatchObject({ state: "ready" });
    });
  });

  describe("ignored repositories", () => {
    const ignored = { "github.com/acme/widgets": { assignOnStart: false, ignored: true } };

    it("drops the default search results of an ignored repository, whatever the spelling of its owner", async () => {
      const exec = fakeExec({ ...ready, "gh search issues": ok(fixture("gh/search-issues.json")) });
      const { deps, pushed } = setup(exec, silentLog, { "github.com/acme/api": { assignOnStart: false, ignored: true } });
      await collectIssues(deps);
      expect(deps.items.all().map((s) => s.item.externalId).sort()).toEqual(["acme/widgets#157", "acme/widgets#161", "solo/tool#61"]);
      expect(pushed).toHaveLength(3);
      expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 3 });
    });

    it("does not run the query of an ignored repository", async () => {
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues-empty.json")),
        "gh issue list": ok(fixture("gh/issue-list.json")),
      });
      const { deps } = setup(exec, silentLog, {
        "github.com/acme/widgets": { query: "no:assignee", assignOnStart: false, ignored: true },
        "github.com/solo/tool": { query: "no:assignee", assignOnStart: false },
      });
      await collectIssues(deps);
      const lists = exec.calls.filter((c) => c.args[0] === "issue" && c.args[1] === "list");
      expect(lists.map((c) => c.args[c.args.indexOf("--repo") + 1])).toEqual(["github.com/solo/tool"]);
      expect(deps.status.get().lastPoll?.sources).not.toHaveProperty(["github.com/acme/widgets"]);
    });

    it("skips an ignored repository in the per-repository fallback", async () => {
      const exec = fakeExec({
        ...ready,
        "gh search issues": fail("unknown command \"search\" for \"gh\""),
        "gh issue list": ok(fixture("gh/issue-list.json")),
      });
      const { deps } = setup(exec, silentLog, ignored);
      deps.repos.upsert({ id: "r1", path: "/c/widgets", originUrl: "github.com/acme/widgets", defaultBranch: "main" }, "t");
      deps.repos.upsert({ id: "r2", path: "/c/tool", originUrl: "github.com/solo/tool", defaultBranch: "main" }, "t");
      await collectIssues(deps);
      expect(exec.calls.filter((c) => c.args[1] === "list").map((c) => c.args[c.args.indexOf("--repo") + 1])).toEqual(["github.com/solo/tool"]);
    });

    it("keeps what it has: nothing is deleted, flagged closed upstream or asked about, and un-ignoring brings the same items back", async () => {
      const sources: Config["sources"] = {};
      const exec = fakeExec({
        ...ready,
        "gh search issues": ok(fixture("gh/search-issues.json")),
        "gh issue view": ok(fixture("gh/issue-view-closed.json")),
      });
      const { deps, pushed } = setup(exec, silentLog);
      deps.sources = () => sources;
      await collectIssues(deps);
      const ids = Object.fromEntries(deps.items.all().map((s) => [s.item.externalId, s.item.id]));
      const eventsBefore = deps.items.all().map((s) => deps.events.forItem(s.item.id).length);

      sources["github.com/acme/widgets"] = { assignOnStart: false, ignored: true };
      pushed.length = 0;
      exec.calls.length = 0;
      await collectIssues(deps);
      expect(deps.items.all()).toHaveLength(4);
      expect(deps.items.all().every((s) => s.item.state === "ready" && !s.item.closedUpstream)).toBe(true);
      expect(deps.items.all().map((s) => deps.events.forItem(s.item.id).length)).toEqual(eventsBefore);
      expect(exec.calls.some((c) => c.args[1] === "view")).toBe(false);
      expect(pushed).toEqual([]);

      delete sources["github.com/acme/widgets"];
      await collectIssues(deps);
      expect(Object.fromEntries(deps.items.all().map((s) => [s.item.externalId, s.item.id]))).toEqual(ids);
      expect(deps.items.all().map((s) => deps.events.forItem(s.item.id).length)).toEqual(eventsBefore);
    });
  });
});
