import { describe, expect, it } from "vitest";
import type { Ctx } from "../ids.js";
import { collect, externalIdOf, linkRepo, markClosedUpstream, refresh, type SourceIssue } from "./collect.js";
import type { WorkItem } from "./types.js";

function makeCtx(): Ctx {
  let n = 0;
  return { now: () => "2026-10-03T12:00:00.000Z", newId: () => `id-${++n}` };
}

const issue: SourceIssue = {
  repository: "owner/repo",
  number: 7,
  url: "https://github.com/owner/repo/issues/7",
  title: "Fix it",
  body: "Body",
  labels: ["bug"],
  createdAt: "2026-09-01T08:00:00Z",
};

function existing(extra: Partial<WorkItem> = {}): WorkItem {
  return { ...collect(issue, makeCtx()).item, updatedAt: "2026-10-01T00:00:00.000Z", ...extra };
}

describe("externalIdOf", () => {
  it("is owner/repo#number", () => {
    expect(externalIdOf(issue)).toBe("owner/repo#7");
  });
});

describe("collect", () => {
  it("creates a ready item and an item.collected event", () => {
    const { item, events } = collect(issue, makeCtx(), { repoId: "r-1" });
    expect(item).toMatchObject({
      id: "id-1", source: "github-issue", externalId: "owner/repo#7", externalUrl: issue.url, repoId: "r-1",
      title: "Fix it", body: "Body", labels: ["bug"], state: "ready", playbook: "implement", priority: 2,
      issueCreatedAt: "2026-09-01T08:00:00Z", stateSince: "2026-10-03T12:00:00.000Z",
    });
    expect(events).toEqual([
      {
        id: "id-2", itemId: "id-1", at: "2026-10-03T12:00:00.000Z", actor: "system", type: "item.collected",
        payload: { externalId: "owner/repo#7", url: issue.url },
      },
    ]);
  });

  it("collects a pull request to review with the review playbook (D40)", () => {
    const pr = { ...issue, number: 9, url: "https://github.com/owner/repo/pull/9", source: "github-pr" as const };
    expect(collect(pr, makeCtx()).item).toMatchObject({ source: "github-pr", externalId: "owner/repo#9", playbook: "review" });
    expect(collect(pr, makeCtx(), { playbook: "custom" }).item.playbook).toBe("custom");
  });

  it("leaves repoId absent without a local clone", () => {
    expect(collect(issue, makeCtx()).item).not.toHaveProperty("repoId");
  });

  it("derives the priority from the labels", () => {
    expect(collect({ ...issue, labels: ["bug", "P1"] }, makeCtx()).item.priority).toBe(1);
  });
});

describe("refresh", () => {
  it("returns undefined when nothing changed", () => {
    expect(refresh(existing(), issue, makeCtx())).toBeUndefined();
  });

  it("applies new title, body and labels without touching state", () => {
    const next = refresh(existing({ state: "running" }), { ...issue, title: "New", labels: ["bug", "x"] }, makeCtx());
    expect(next).toMatchObject({ title: "New", labels: ["bug", "x"], state: "running", updatedAt: "2026-10-03T12:00:00.000Z" });
  });

  it("recomputes the priority when the labels change", () => {
    expect(refresh(existing(), { ...issue, labels: ["priority: critical"] }, makeCtx())?.priority).toBe(0);
    expect(refresh(existing({ priority: 0 }), issue, makeCtx())?.priority).toBe(2);
  });

  it("fills in issueCreatedAt on an item collected without it", () => {
    const { issueCreatedAt: _gone, ...old } = existing();
    expect(refresh(old, issue, makeCtx())?.issueCreatedAt).toBe("2026-09-01T08:00:00Z");
  });

  it("clears closedUpstream when the issue is open again", () => {
    const next = refresh(existing({ closedUpstream: true }), issue, makeCtx());
    expect(next).toBeDefined();
    expect(next).not.toHaveProperty("closedUpstream");
  });
});

describe("markClosedUpstream", () => {
  it("flags an open item", () => {
    expect(markClosedUpstream(existing(), makeCtx())).toMatchObject({ closedUpstream: true });
  });

  it("ignores done and already flagged items", () => {
    expect(markClosedUpstream(existing({ state: "done" }), makeCtx())).toBeUndefined();
    expect(markClosedUpstream(existing({ closedUpstream: true }), makeCtx())).toBeUndefined();
  });

  it("flags an archived done item, so a reopened issue is recognised (D37)", () => {
    const archived = existing({ state: "done", archivedAt: "2026-10-02T00:00:00.000Z" });
    expect(markClosedUpstream(archived, makeCtx())).toMatchObject({ closedUpstream: true });
  });
});

describe("linkRepo", () => {
  it("links, unlinks and reports no change", () => {
    const linked = linkRepo(existing(), "r-1", makeCtx());
    expect(linked?.repoId).toBe("r-1");
    expect(linkRepo(linked!, "r-1", makeCtx())).toBeUndefined();
    expect(linkRepo(linked!, undefined, makeCtx())).not.toHaveProperty("repoId");
  });
});
