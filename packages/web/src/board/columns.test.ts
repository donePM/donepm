import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { displayId, groupByColumn, labelTone } from "./columns";

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
    priority: n,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    repo: { id: "r1", path: "/x", originUrl: "github.com/acme/widgets", defaultBranch: "main" },
    badges: [],
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

  it("orders Ready by priority with unstartable items last", () => {
    const g = groupByColumn([
      item({ id: "noclone", priority: 1, repo: null, badges: ["no-local-clone"] }),
      item({ id: "second", priority: 3 }),
      item({ id: "first", priority: 2 }),
    ]);
    expect(g.ready.map((i) => i.id)).toEqual(["first", "second", "noclone"]);
  });

  it("orders Done newest first", () => {
    const g = groupByColumn([
      item({ id: "old", state: "done", updatedAt: "2026-10-01T00:00:00Z" }),
      item({ id: "new", state: "done", updatedAt: "2026-10-02T00:00:00Z" }),
    ]);
    expect(g.done.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("displayId", () => {
  it("separates the number", () => expect(displayId("acme/widgets#42")).toBe("acme/widgets #42"));
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
