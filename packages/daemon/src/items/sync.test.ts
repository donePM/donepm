import type { SourceIssue } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { TombstoneStore } from "../retention/tombstones.js";
import { ItemStore } from "./store.js";
import { applyClosedUpstream, issueOrigin, relinkItems, syncIssues } from "./sync.js";

function setup() {
  const db = openDb(":memory:");
  const deps = { db, items: new ItemStore(db), events: new EventStore(db), repos: new RepoStore(db), ctx: testCtx() };
  return deps;
}

const a: SourceIssue = { repository: "Acme/Widgets", number: 1, url: "https://github.com/Acme/Widgets/issues/1", title: "A", body: "a", labels: ["bug"], createdAt: "2026-09-01T08:00:00Z" };
const b: SourceIssue = { repository: "solo/tool", number: 2, url: "https://github.com/solo/tool/issues/2", title: "B", body: "b", labels: [], createdAt: "2026-09-02T08:00:00Z" };

describe("issueOrigin", () => {
  it("is the lower-cased host/owner/repo", () => {
    expect(issueOrigin(a)).toBe("github.com/acme/widgets");
  });
});

describe("syncIssues", () => {
  it("collects new issues as ready items with an item.collected event", () => {
    const d = setup();
    d.repos.upsert({ id: "r1", path: "/code/widgets", originUrl: "github.com/acme/widgets", defaultBranch: "main" }, "t");
    const r = syncIssues([a, b], d);
    expect(r.collected.map((i) => [i.externalId, i.state, i.repoId, i.priority])).toEqual([
      ["Acme/Widgets#1", "ready", "r1", 2],
      ["solo/tool#2", "ready", undefined, 2],
    ]);
    const stored = d.items.byExternalId("Acme/Widgets#1")!;
    expect(stored.originUrl).toBe("github.com/acme/widgets");
    expect(d.events.forItem(stored.item.id).map((e) => e.type)).toEqual(["item.collected"]);
  });

  it("starts a repository's new issues with its default playbook, pull requests with theirs (issue #127)", () => {
    const d = setup();
    const pr: SourceIssue = { ...a, number: 3, url: "https://github.com/Acme/Widgets/pull/3", source: "github-pr" };
    const playbookFor = (origin: string) => (origin === "github.com/acme/widgets" ? "dependency-update" : undefined);
    const r = syncIssues([a, b, pr], { ...d, playbookFor });
    expect(r.collected.map((i) => [i.externalId, i.playbook])).toEqual([
      ["Acme/Widgets#1", "dependency-update"],
      ["solo/tool#2", "implement"],
      ["Acme/Widgets#3", "review"],
    ]);
  });

  it("is idempotent: polling the same issues again changes nothing and adds no events", () => {
    const d = setup();
    syncIssues([a], d);
    const r = syncIssues([a], d);
    expect(r).toEqual({ collected: [], updated: [], missing: [], openTombstones: [] });
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    expect(d.events.forItem(id)).toHaveLength(1);
  });

  it("stores the sort keys and recomputes the priority when the labels change", () => {
    const d = setup();
    syncIssues([{ ...a, labels: ["P1"] }], d);
    const stored = d.items.byExternalId("Acme/Widgets#1")!.item;
    expect(stored).toMatchObject({ priority: 1, issueCreatedAt: "2026-09-01T08:00:00Z", stateSince: stored.createdAt });
    expect(stored).not.toHaveProperty("startedAt");
    syncIssues([{ ...a, labels: ["priority: low"] }], d);
    expect(d.items.get(stored.id)!.item.priority).toBe(3);
  });

  it("records a priority set on GitHub as item.refreshed, once (D45)", () => {
    const d = setup();
    syncIssues([a], d);
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    const r = syncIssues([{ ...a, priorityField: "High" }], d);
    expect(r.updated.map((i) => i.priority)).toEqual([1]);
    syncIssues([{ ...a, priorityField: "High" }], d);
    const events = d.events.forItem(id);
    expect(events.map((e) => e.type)).toEqual(["item.collected", "item.refreshed"]);
    expect(events[1]!.payload).toEqual({ changed: { priority: { from: 2, to: 1 } } });
  });

  it("adds no event for a body change", () => {
    const d = setup();
    syncIssues([a], d);
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    syncIssues([{ ...a, body: "edited" }], d);
    expect(d.items.get(id)!.item.body).toBe("edited");
    expect(d.events.forItem(id).map((e) => e.type)).toEqual(["item.collected"]);
  });

  it("updates content of known items without touching state", () => {
    const d = setup();
    syncIssues([a], d);
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    d.items.update({ ...d.items.get(id)!.item, state: "running" });
    const r = syncIssues([{ ...a, title: "A2", labels: [] }], d);
    expect(r.updated.map((i) => [i.title, i.state, i.labels])).toEqual([["A2", "running", []]]);
  });

  it("reports items missing from the result, except done and already flagged ones", () => {
    const d = setup();
    syncIssues([a, b], d);
    const idB = d.items.byExternalId("solo/tool#2")!.item.id;
    expect(syncIssues([], d).missing.map((i) => i.externalId)).toEqual(["Acme/Widgets#1", "solo/tool#2"]);
    d.items.update({ ...d.items.get(idB)!.item, state: "done" });
    expect(syncIssues([], d).missing.map((i) => i.externalId)).toEqual(["Acme/Widgets#1"]);
  });

  it("never deletes items", () => {
    const d = setup();
    syncIssues([a, b], d);
    syncIssues([], d);
    expect(d.items.all()).toHaveLength(2);
  });

  it("moves a never-started item to done when its issue was closed upstream", () => {
    const d = setup();
    syncIssues([a], d);
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    expect(applyClosedUpstream(id, d)).toMatchObject({ state: "done", closedUpstream: true });
    expect(d.items.get(id)!.item.state).toBe("done");
    expect(d.events.forItem(id).map((e) => e.type)).toEqual(["item.collected", "item.closed_upstream"]);
    expect(syncIssues([], d).missing).toEqual([]);
  });

  it("flags a started item closed upstream and clears the flag when the issue shows up open again", () => {
    const d = setup();
    syncIssues([a], d);
    const stored = d.items.byExternalId("Acme/Widgets#1")!.item;
    d.items.update({ ...stored, worktreePath: "/wt/1" });
    const id = stored.id;
    expect(applyClosedUpstream(id, d)).toMatchObject({ state: "ready", closedUpstream: true });
    expect(applyClosedUpstream(id, d)).toBeUndefined();
    expect(d.events.forItem(id).map((e) => e.type)).toEqual(["item.collected"]);
    expect(syncIssues([], d).missing).toEqual([]);
    expect(syncIssues([a], d).updated[0]).not.toHaveProperty("closedUpstream");
  });
});

describe("syncIssues: archived and purged issues (D37)", () => {
  const archive = (d: ReturnType<typeof setup>, externalId: string) => {
    const { item } = d.items.byExternalId(externalId)!;
    d.items.update({ ...item, state: "done", archivedAt: "2026-10-02T00:00:00.000Z" });
    return item.id;
  };

  it("skips an archived item's issue while it stays open, and asks whether it was closed", () => {
    const d = setup();
    syncIssues([a], d);
    const id = archive(d, "Acme/Widgets#1");
    const r = syncIssues([a], d);
    expect(r).toEqual({ collected: [], updated: [], missing: [], openTombstones: [] });
    expect(d.items.all()).toHaveLength(1);
    // Not in the poll: confirm whether it was closed, so a later reopen is recognised.
    expect(syncIssues([], d).missing.map((i) => i.id)).toEqual([id]);
    applyClosedUpstream(id, d);
    expect(d.items.get(id)!.item).toMatchObject({ closedUpstream: true, state: "done" });
    expect(syncIssues([], d).missing).toEqual([]);
  });

  it("collects a reopened issue as a new item and keeps the archived one", () => {
    const d = setup();
    syncIssues([a], d);
    const old = archive(d, "Acme/Widgets#1");
    applyClosedUpstream(old, d);
    const r = syncIssues([a], d);
    expect(r.collected).toHaveLength(1);
    expect(r.collected[0]!.id).not.toBe(old);
    expect(d.items.byExternalId("Acme/Widgets#1")!.item.id).toBe(r.collected[0]!.id);
    expect(d.items.get(old)!.item.archivedAt).toBeDefined();
    expect(syncIssues([a], d).collected).toEqual([]);
  });

  it("skips a purged issue while its tombstone is open, imports it fresh once seen closed", () => {
    const d = setup();
    const tombstones = new TombstoneStore(d.db);
    tombstones.put({ externalId: "Acme/Widgets#1", source: "github-issue", originUrl: "github.com/acme/widgets", closed: false, deletedAt: "t" });
    expect(syncIssues([a], d).collected).toEqual([]);
    expect(syncIssues([], d).openTombstones.map((t) => t.externalId)).toEqual(["Acme/Widgets#1"]);
    expect(syncIssues([], d, (origin) => origin !== "github.com/acme/widgets").openTombstones).toEqual([]);

    tombstones.markClosed("Acme/Widgets#1");
    expect(syncIssues([], d).openTombstones).toEqual([]);
    expect(syncIssues([a], d).collected.map((i) => i.externalId)).toEqual(["Acme/Widgets#1"]);
    expect(tombstones.get("Acme/Widgets#1")).toBeUndefined();
  });
});

describe("relinkItems", () => {
  it("links items to clones found later and unlinks vanished ones", () => {
    const d = setup();
    syncIssues([a], d);
    d.repos.upsert({ id: "r1", path: "/code/widgets", originUrl: "github.com/acme/widgets", defaultBranch: "main" }, "t");
    expect(relinkItems(d).map((i) => i.repoId)).toEqual(["r1"]);
    expect(relinkItems(d)).toEqual([]);
    d.repos.removeExcept([]);
    expect(d.items.all()[0]!.item.repoId).toBeUndefined();
  });
});
