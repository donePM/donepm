import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { displayId, groupByColumn, labelTone, shortId } from "./columns";

let n = 0;
function item(over: Partial<ItemView>): ItemView {
  n++;
  return {
    id: `i${n}`,
    source: "github-issue",
    externalId: `acme/widgets#${n}`,
    externalUrl: `https://github.com/acme/widgets/issues/${n}`,
    title: `Item ${n}`,
    body: "",
    labels: [],
    state: "ready",
    playbook: "implement",
    priority: 2,
    stateSince: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    repo: { id: "r1", path: "/x", originUrl: "github.com/acme/widgets", defaultBranch: "main" },
    badges: [],
    agent: { running: false },
    ...over,
  };
}

describe("groupByColumn", () => {
  it("puts each state into its column, failed into Needs You", () => {
    const g = groupByColumn([
      item({ id: "a", state: "ready" }),
      item({ id: "b", state: "running" }),
      item({ id: "c", state: "needs_you" }),
      item({ id: "d", state: "failed" }),
      item({ id: "e", state: "done" }),
    ]);
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((i) => i.id)]))).toEqual({
      ready: ["a"],
      in_progress: ["b"],
      needs_you: ["c", "d"],
      done: ["e"],
    });
  });

  const ids = (items: ItemView[]) => items.map((i) => i.id);

  it("orders Ready by priority tier, then oldest issue, with unstartable items last", () => {
    const g = groupByColumn([
      item({ id: "noclone", priority: 0, repo: null, badges: ["no-local-clone"] }),
      item({ id: "low", priority: 3, issueCreatedAt: "2026-01-01T00:00:00Z" }),
      item({ id: "newer", priority: 2, issueCreatedAt: "2026-09-02T00:00:00Z" }),
      item({ id: "older", priority: 2, issueCreatedAt: "2026-09-01T00:00:00Z" }),
      item({ id: "urgent", priority: 0, issueCreatedAt: "2026-09-30T00:00:00Z" }),
    ]);
    expect(ids(g.ready)).toEqual(["urgent", "older", "newer", "low", "noclone"]);
  });

  it("compares GitHub and daemon timestamps by time, not as text", () => {
    const g = groupByColumn([
      item({ id: "later", issueCreatedAt: "2026-09-01T00:00:00.500Z" }),
      item({ id: "earlier", issueCreatedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(ids(g.ready)).toEqual(["earlier", "later"]);
  });

  it("orders In Progress by first start and keeps a card's place across a Needs You round trip", () => {
    const a = item({ id: "a", state: "running", startedAt: "2026-10-03T10:00:00Z", stateSince: "2026-10-03T10:00:00Z" });
    const b = item({ id: "b", state: "running", startedAt: "2026-10-03T11:00:00Z", stateSince: "2026-10-03T11:00:00Z" });
    const c = item({ id: "c", state: "running", startedAt: "2026-10-03T12:00:00Z", stateSince: "2026-10-03T12:00:00Z" });
    expect(ids(groupByColumn([c, a, b]).in_progress)).toEqual(["a", "b", "c"]);

    const aWaits = { ...a, state: "needs_you" as const, stateSince: "2026-10-03T13:00:00Z" };
    expect(ids(groupByColumn([c, aWaits, b]).in_progress)).toEqual(["b", "c"]);
    const aBack = { ...a, stateSince: "2026-10-03T14:00:00Z" };
    expect(ids(groupByColumn([c, aBack, b]).in_progress)).toEqual(["a", "b", "c"]);
  });

  it("orders Needs You oldest waiting first, failed items included", () => {
    const g = groupByColumn([
      item({ id: "recent", state: "needs_you", stateSince: "2026-10-03T12:00:00Z" }),
      item({ id: "failed", state: "failed", stateSince: "2026-10-03T11:00:00Z" }),
      item({ id: "longest", state: "needs_you", stateSince: "2026-10-03T10:00:00Z" }),
    ]);
    expect(ids(g.needs_you)).toEqual(["longest", "failed", "recent"]);
  });

  it("orders Done newest first and ignores later updates", () => {
    const g = groupByColumn([
      item({ id: "old", state: "done", stateSince: "2026-10-01T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" }),
      item({ id: "new", state: "done", stateSince: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" }),
    ]);
    expect(ids(g.done)).toEqual(["new", "old"]);
  });

  it.each([
    ["ready", {}],
    ["running", { startedAt: "2026-10-03T10:00:00Z" }],
    ["needs_you", {}],
    ["done", {}],
  ] as const)("breaks ties in %s by external id, numbers in order", (state, extra) => {
    const tied = (id: string, externalId: string) => item({ id, externalId, state, ...extra });
    const g = groupByColumn([tied("ten", "acme/widgets#10"), tied("nine", "acme/widgets#9"), tied("other", "acme/api#50")]);
    expect(ids(Object.values(g).flat())).toEqual(["other", "nine", "ten"]);
  });
});

describe("displayId", () => {
  it("separates the number", () => expect(displayId("acme/widgets#42")).toBe("acme/widgets #42"));
  it("shows a ticket's key without its connection (issue #139)", () => {
    expect(displayId("jira:APP-123")).toBe("APP-123");
    expect(shortId("jira:APP-123")).toBe("APP-123");
    expect(displayId("ado:1234")).toBe("#1234");
    expect(shortId("ado:1234")).toBe("#1234");
  });
});

describe("shortId", () => {
  it("keeps only the number", () => expect(shortId("acme/widgets#42")).toBe("#42"));
  it("leaves an id without a number alone", () => expect(shortId("PROJ-42")).toBe("PROJ-42"));
});

describe("labelTone", () => {
  it.each([
    ["bug", "bug"],
    ["type: Bug", "bug"],
    ["enhancement", "feature"],
    ["feature", "feature"],
    ["search", "plain"],
  ])("%s → %s", (label, tone) => expect(labelTone(label)).toBe(tone));
});
