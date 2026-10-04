import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { mergeNote } from "./merge-note";

const PR = { url: "https://github.com/acme/widgets/pull/45", number: 45 };

function item(over: Partial<ItemView>): ItemView {
  return {
    id: "i1",
    source: "github-issue",
    externalId: "acme/widgets#7",
    externalUrl: "https://github.com/acme/widgets/issues/7",
    title: "Fix",
    body: "",
    labels: [],
    state: "done",
    playbook: "implement",
    priority: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    repo: { id: "r1", path: "/x", originUrl: "github.com/acme/widgets", defaultBranch: "main" },
    badges: [],
    agent: { running: false },
    worktreePath: "/wt/7",
    pr: { ...PR, merged: false },
    ...over,
  };
}

describe("mergeNote", () => {
  it("says the worktree waits for the merge only when the user opted in", () => {
    expect(mergeNote(item({}), true)).toEqual({ kind: "pending" });
    expect(mergeNote(item({}), false)).toBeUndefined();
    expect(mergeNote(item({ worktreePath: undefined }), true)).toBeUndefined();
  });

  it("says the PR was merged, whether or not the worktree went", () => {
    expect(mergeNote(item({ pr: { ...PR, merged: true } }), false)).toEqual({ kind: "merged" });
    expect(mergeNote(item({ pr: { ...PR, merged: true }, worktreePath: undefined }), true)).toEqual({ kind: "merged" });
  });

  it("says why a merged PR's worktree was kept while the setting is on", () => {
    const pr = { ...PR, merged: true, removeSkipped: "uncommitted changes" };
    expect(mergeNote(item({ pr }), true)).toEqual({ kind: "skipped", reason: "uncommitted changes" });
    expect(mergeNote(item({ pr }), false)).toEqual({ kind: "merged" });
  });

  it("says nothing without a PR or before Done", () => {
    expect(mergeNote(item({ pr: undefined }), true)).toBeUndefined();
    expect(mergeNote(item({ state: "running" }), true)).toBeUndefined();
  });
});
