import { prMerged, type Ctx, type Retention, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { AskStore } from "../asks/store.js";
import { openDb } from "../db/database.js";
import { DraftStore } from "../drafts/store.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import { TranscriptStore } from "../transcript/store.js";
import { applyRetention } from "./retention.js";
import { TombstoneStore } from "./tombstones.js";

const T0 = "2026-10-01T10:00:00.000Z";
const hours = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();
const PR = { url: "https://github.com/o/r/pull/9", number: 9 };

/** Stores, an injected clock the test moves, and helpers to add items in a given shape. */
function setup(retention: Retention = { archiveAfterHours: 24, deleteAfterDays: 7 }) {
  const db = openDb(":memory:");
  const clock = { now: T0 };
  let n = 0;
  const ctx: Ctx = { now: () => clock.now, newId: () => `id-${++n}` };
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const drafts = new DraftStore(db);
  const asks = new AskStore(db);
  const transcript = new TranscriptStore(db);
  const pushed: WorkItem[] = [];
  const writer = itemWriter({ db, items, events, onItem: (i) => pushed.push(i), onEvent: () => {} });
  const logged: Array<{ obj: object; msg?: string }> = [];
  const log: Log = { info: (obj, msg) => void logged.push({ obj, msg }), warn: () => {}, error: () => {} };
  const settings = { ...retention };
  const run = () => applyRetention({ db, items, events, drafts, asks, writer, ctx, log, retention: () => settings });

  const add = (id: string, extra: Partial<WorkItem> = {}): WorkItem => {
    const item: WorkItem = {
      id, source: "github-issue", externalId: `o/r#${id}`, externalUrl: `https://github.com/o/r/issues/${id}`,
      title: id, body: "", labels: [], state: "done", playbook: "implement", priority: 2,
      stateSince: clock.now, createdAt: T0, updatedAt: T0, ...extra,
    };
    items.insert(item, "github.com/o/r");
    events.append([{ id: `${id}-c`, itemId: id, at: T0, actor: "system", type: "item.collected", payload: {} }]);
    return item;
  };
  const withPr = (id: string) => {
    drafts.insert({ id: `${id}-d`, itemId: id, type: "pr", payload: { title: id, body: "", base: "main" }, state: "pending" }, T0);
    drafts.setState(`${id}-d`, "executed", T0);
    drafts.setResult(`${id}-d`, PR, T0);
  };
  const at = (t: string) => void (clock.now = t);
  const item = (id: string) => items.get(id)?.item;
  return { db, items, events, drafts, asks, transcript, writer, ctx, settings, pushed, logged, run, add, withPr, at, item };
}

describe("applyRetention: archive", () => {
  it("archives a done item without a PR archiveAfterHours after it became done", () => {
    const t = setup();
    t.add("a", { closedUpstream: true });
    t.at(hours(23));
    expect(t.run().archived).toEqual([]);
    t.at(hours(24));
    expect(t.run().archived).toEqual(["a"]);
    expect(t.item("a")).toMatchObject({ state: "done", archivedAt: hours(24) });
    expect(t.events.forItem("a").at(-1)).toMatchObject({
      type: "item.archived", actor: "system", at: hours(24), payload: { finishedAt: T0 },
    });
    expect(t.pushed.at(-1)).toMatchObject({ id: "a", archivedAt: hours(24) });
    // Once only.
    t.at(hours(48));
    expect(t.run().archived).toEqual([]);
  });

  it("counts from the merge for an item with a PR, and waits while it is not merged", () => {
    const t = setup();
    t.add("p");
    t.withPr("p");
    t.at(hours(100));
    expect(t.run().archived).toEqual([]);
    t.writer.commit(prMerged(t.item("p")!, t.ctx, PR));
    t.at(hours(123));
    expect(t.run().archived).toEqual([]);
    t.at(hours(124));
    expect(t.run().archived).toEqual(["p"]);
    expect(t.events.forItem("p").at(-1)?.payload).toEqual({ finishedAt: hours(100) });
  });

  it("archives at once with archiveAfterHours 0", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: null });
    t.add("a");
    expect(t.run().archived).toEqual(["a"]);
  });

  it("leaves items that are not done or still wait on a draft or an ask", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: null });
    t.add("r", { state: "running" });
    t.add("d");
    t.drafts.insert({ id: "d-d", itemId: "d", type: "pr", payload: { title: "d", body: "", base: "main" }, state: "pending" }, T0);
    t.add("k");
    t.asks.insert({ id: "k-a", itemId: "k", requestId: "r1", toolName: "Bash", input: {}, state: "pending", rules: [] }, T0);
    expect(t.run().archived).toEqual([]);
  });

  it("applies a changed setting on the next run", () => {
    const t = setup();
    t.add("a");
    t.at(hours(2));
    expect(t.run().archived).toEqual([]);
    t.settings.archiveAfterHours = 1;
    expect(t.run().archived).toEqual(["a"]);
  });
});

describe("applyRetention: purge", () => {
  it("deletes an archived item with its events, drafts, asks and transcript after deleteAfterDays, leaving a tombstone", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: 7 });
    t.add("a", { closedUpstream: true });
    t.withPr("a");
    t.writer.commit(prMerged(t.item("a")!, t.ctx, PR));
    t.asks.insert({ id: "a-k", itemId: "a", requestId: "r1", toolName: "Bash", input: {}, state: "allowed", rules: [] }, T0);
    t.transcript.append({ id: "a-t", itemId: "a", sessionId: "s", at: T0, kind: "assistant_text", raw: { type: "assistant" } });
    expect(t.run().archived).toEqual(["a"]);

    t.at(hours(7 * 24 - 1));
    expect(t.run().purged).toEqual([]);
    t.at(hours(7 * 24));
    expect(t.run().purged).toEqual(["a"]);

    expect(t.item("a")).toBeUndefined();
    expect(t.events.forItem("a")).toEqual([]);
    expect(t.drafts.forItem("a")).toEqual([]);
    expect(t.asks.forItem("a")).toEqual([]);
    expect(t.transcript.page("a")).toEqual([]);
    expect(new TombstoneStore(t.db).get("o/r#a")).toEqual({
      externalId: "o/r#a", source: "github-issue", originUrl: "github.com/o/r", closed: true, deletedAt: hours(7 * 24),
    });
    expect(t.logged.at(-1)).toMatchObject({ obj: { itemId: "a", externalId: "o/r#a" }, msg: "purged archived item" });
  });

  it("keeps an archived item that still has a worktree until it is removed", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: 0 });
    t.add("w", { worktreePath: "/wt/w" });
    t.run();
    t.at(hours(1000));
    expect(t.run().purged).toEqual([]);
    const { worktreePath: _, ...rest } = t.item("w")!;
    t.writer.save(rest);
    expect(t.run().purged).toEqual(["w"]);
  });

  it("never deletes with deleteAfterDays null", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: null });
    t.add("a");
    t.run();
    t.at(hours(100_000));
    expect(t.run().purged).toEqual([]);
    expect(t.item("a")?.archivedAt).toBe(T0);
  });

  it("does not touch live items or their events", () => {
    const t = setup({ archiveAfterHours: 0, deleteAfterDays: 0 });
    t.add("r", { state: "ready" });
    t.add("a");
    t.run();
    t.run();
    expect(t.item("r")).toBeDefined();
    expect(t.events.forItem("r")).toHaveLength(1);
    expect(t.item("a")).toBeUndefined();
  });
});
