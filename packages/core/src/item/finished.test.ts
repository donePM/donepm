import { describe, expect, it } from "vitest";
import type { Event, EventType } from "../event/types.js";
import { archiveDue, finishedAt, purgeDue } from "./finished.js";
import type { ItemState, WorkItem } from "./types.js";

const DONE_AT = "2026-10-01T10:00:00.000Z";

function item(state: ItemState, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "item-1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1",
    title: "T", body: "", labels: [], state, playbook: "implement", priority: 2,
    stateSince: DONE_AT, createdAt: DONE_AT, updatedAt: DONE_AT, ...extra,
  };
}

let n = 0;
const ev = (type: EventType, at: string, payload: Record<string, unknown> = {}): Event => ({
  id: `e-${++n}`, itemId: "item-1", at, actor: "system", type, payload,
});

describe("finishedAt", () => {
  it("is undefined for every state but done", () => {
    for (const s of ["ready", "running", "needs_you", "checking", "failed"] as const) {
      expect(finishedAt(item(s), [], false)).toBeUndefined();
    }
  });

  it("waits for someone else's open pull request, and is when it closed after that (D47)", () => {
    const pr = { source: "github-pr" as const, prStatus: { mergeable: "MERGEABLE", base: "main", state: "OPEN" } };
    expect(finishedAt(item("done", pr), [], false)).toBeUndefined();
    const merged = { ...pr.prStatus, state: "MERGED", closedAt: "2026-10-02T09:00:00.000Z" };
    expect(finishedAt(item("done", { ...pr, prStatus: merged }), [], false)).toBe("2026-10-02T09:00:00.000Z");
    expect(finishedAt(item("done", { ...pr, prStatus: { ...merged, closedAt: "2026-09-30T09:00:00.000Z" } }), [], false)).toBe(DONE_AT);
    expect(finishedAt(item("done", { source: "github-pr" }), [], false)).toBe(DONE_AT);
  });

  it("is when it became done for an item without a PR (closed upstream, dismissed)", () => {
    expect(finishedAt(item("done", { closedUpstream: true }), [], false)).toBe(DONE_AT);
  });

  it("waits for the merge of an item with a PR", () => {
    expect(finishedAt(item("done"), [ev("ci.passed", DONE_AT)], true)).toBeUndefined();
  });

  it("is when the merge was seen, by item.pr_merged or a removal for it", () => {
    const later = "2026-10-02T08:00:00.000Z";
    expect(finishedAt(item("done"), [ev("item.pr_merged", later)], true)).toBe(later);
    expect(finishedAt(item("done"), [ev("worktree.removed", later, { reason: "pr_merged" })], true)).toBe(later);
    expect(finishedAt(item("done"), [ev("worktree.removed", later)], true)).toBeUndefined();
  });

  it("is when it became done again if that came after the merge", () => {
    const merged = "2026-09-30T00:00:00.000Z";
    expect(finishedAt(item("done"), [ev("item.pr_merged", merged)], true)).toBe(DONE_AT);
  });
});

describe("archiveDue", () => {
  const finished = "2026-10-01T10:00:00.000Z";
  it("is due once archiveAfterHours have passed", () => {
    expect(archiveDue(finished, "2026-10-02T09:59:59.999Z", { archiveAfterHours: 24 })).toBe(false);
    expect(archiveDue(finished, "2026-10-02T10:00:00.000Z", { archiveAfterHours: 24 })).toBe(true);
  });

  it("is due at once with 0", () => {
    expect(archiveDue(finished, finished, { archiveAfterHours: 0 })).toBe(true);
  });
});

describe("purgeDue", () => {
  const archivedAt = "2026-10-01T10:00:00.000Z";
  const archived = item("done", { archivedAt });

  it("is due once deleteAfterDays have passed since archiving", () => {
    expect(purgeDue(archived, "2026-10-08T09:59:59.999Z", { deleteAfterDays: 7 })).toBe(false);
    expect(purgeDue(archived, "2026-10-08T10:00:00.000Z", { deleteAfterDays: 7 })).toBe(true);
    expect(purgeDue(archived, archivedAt, { deleteAfterDays: 0 })).toBe(true);
  });

  it("never with deleteAfterDays null", () => {
    expect(purgeDue(archived, "2030-01-01T00:00:00.000Z", { deleteAfterDays: null })).toBe(false);
  });

  it("never for an item that is not archived or still has a worktree", () => {
    const later = "2030-01-01T00:00:00.000Z";
    expect(purgeDue(item("done"), later, { deleteAfterDays: 0 })).toBe(false);
    expect(purgeDue({ ...archived, worktreePath: "/w" }, later, { deleteAfterDays: 0 })).toBe(false);
  });
});
