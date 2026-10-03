import type { SourceIssue } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { ItemStore } from "./store.js";
import { applyClosedUpstream, issueOrigin, relinkItems, syncIssues } from "./sync.js";

function setup() {
  const db = openDb(":memory:");
  const deps = { db, items: new ItemStore(db), events: new EventStore(db), repos: new RepoStore(db), ctx: testCtx() };
  return deps;
}

const a: SourceIssue = { repository: "Acme/Widgets", number: 1, url: "https://github.com/Acme/Widgets/issues/1", title: "A", body: "a", labels: ["bug"] };
const b: SourceIssue = { repository: "solo/tool", number: 2, url: "https://github.com/solo/tool/issues/2", title: "B", body: "b", labels: [] };

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
      ["Acme/Widgets#1", "ready", "r1", 0],
      ["solo/tool#2", "ready", undefined, 1],
    ]);
    const stored = d.items.byExternalId("Acme/Widgets#1")!;
    expect(stored.originUrl).toBe("github.com/acme/widgets");
    expect(d.events.forItem(stored.item.id).map((e) => e.type)).toEqual(["item.collected"]);
  });

  it("is idempotent: polling the same issues again changes nothing and adds no events", () => {
    const d = setup();
    syncIssues([a], d);
    const r = syncIssues([a], d);
    expect(r).toEqual({ collected: [], updated: [], missing: [] });
    const id = d.items.byExternalId("Acme/Widgets#1")!.item.id;
    expect(d.events.forItem(id)).toHaveLength(1);
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
