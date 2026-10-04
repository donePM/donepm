import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { buildLanes, dependabotCount, laneSummary, NO_CLONE_KEY, repoName, sortLanes, stableOrder } from "./lanes";

let n = 0;
function item(over: Partial<ItemView> & { repoKey?: string | null; origin?: string }): ItemView {
  n++;
  const { repoKey = "r1", origin = "github.com/acme/widgets", ...rest } = over;
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
    stateSince: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    repo: repoKey === null ? null : { id: repoKey, path: `/x/${repoKey}`, originUrl: origin, defaultBranch: "main" },
    badges: [],
    agent: { running: false },
    ...rest,
  };
}

const alpha = (over: Partial<ItemView> = {}) => item({ repoKey: "a", origin: "github.com/acme/alpha", ...over });
const beta = (over: Partial<ItemView> = {}) => item({ repoKey: "b", origin: "github.com/acme/beta", ...over });
const gamma = (over: Partial<ItemView> = {}) => item({ repoKey: "g", origin: "github.com/acme/gamma", ...over });
const orphan = (over: Partial<ItemView> = {}) => item({ repoKey: null, ...over });
const keys = (lanes: { key: string }[]) => lanes.map((l) => l.key);

describe("repoName", () => {
  it("drops the host", () => expect(repoName("github.com/acme/widgets")).toBe("acme/widgets"));
  it("keeps a host other than github.com (issue #140)", () => expect(repoName("github.acme.com/team/app")).toBe("github.acme.com/team/app"));
  it("normalises an unnormalised origin", () => expect(repoName("git@github.com:Acme/Widgets.git")).toBe("acme/widgets"));
});

describe("buildLanes", () => {
  it("groups by repo id and splits each lane into columns", () => {
    const lanes = buildLanes([
      alpha({ id: "a1", state: "ready" }),
      beta({ id: "b1", state: "running" }),
      alpha({ id: "a2", state: "failed" }),
    ]);
    expect(lanes.map((l) => [l.key, l.name])).toEqual([
      ["a", "acme/alpha"],
      ["b", "acme/beta"],
    ]);
    expect(lanes[0]!.columns.needs_you.map((i) => i.id)).toEqual(["a2"]);
    expect(lanes[0]!.counts).toEqual({ ready: 1, in_progress: 0, needs_you: 1, done: 0 });
    expect(lanes[1]!.counts).toEqual({ ready: 0, in_progress: 1, needs_you: 0, done: 0 });
  });

  it("orders cards inside a lane like the columns do", () => {
    const [lane] = buildLanes([alpha({ id: "late", priority: 9 }), alpha({ id: "early", priority: 2 })]);
    expect(lane!.columns.ready.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("puts items without a repo in their own lane", () => {
    const lanes = buildLanes([orphan({ badges: ["no-local-clone"] }), alpha(), orphan({ badges: ["no-local-clone"] })]);
    const noClone = lanes.find((l) => l.key === NO_CLONE_KEY);
    expect(noClone?.name).toBe("No local clone");
    expect(noClone?.counts.ready).toBe(2);
  });

  it("has no lane for a repo without items", () => {
    expect(buildLanes([])).toEqual([]);
  });
});

describe("sortLanes", () => {
  it("puts lanes that need you first, then alphabetical, No local clone last", () => {
    const lanes = buildLanes([
      orphan({ state: "needs_you" }),
      gamma(),
      beta(),
      alpha(),
      gamma({ state: "needs_you" }),
    ]);
    expect(keys(sortLanes(lanes))).toEqual(["g", "a", "b", NO_CLONE_KEY]);
  });

  it("counts a failed item as needing you", () => {
    expect(keys(sortLanes(buildLanes([alpha(), beta({ state: "failed" })])))).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const lanes = buildLanes([beta(), alpha()]);
    sortLanes(lanes);
    expect(keys(lanes)).toEqual(["b", "a"]);
  });
});

describe("stableOrder", () => {
  it("keeps the previous order even when the rule would reorder", () => {
    const lanes = sortLanes(buildLanes([alpha(), beta({ state: "needs_you" })]));
    expect(keys(lanes)).toEqual(["b", "a"]);
    expect(keys(stableOrder(lanes, ["a", "b"]))).toEqual(["a", "b"]);
  });

  it("places new lanes after the known ones, in rule order", () => {
    const lanes = sortLanes(buildLanes([alpha(), beta(), gamma({ state: "needs_you" })]));
    expect(keys(lanes)).toEqual(["g", "a", "b"]);
    expect(keys(stableOrder(lanes, ["b"]))).toEqual(["b", "g", "a"]);
  });

  it("drops lanes that are gone", () => {
    const lanes = sortLanes(buildLanes([alpha()]));
    expect(keys(stableOrder(lanes, ["b", "a"]))).toEqual(["a"]);
  });

  it("keeps No local clone last even if it was known first", () => {
    const lanes = sortLanes(buildLanes([orphan(), alpha()]));
    expect(keys(stableOrder(lanes, [NO_CLONE_KEY, "a"]))).toEqual(["a", NO_CLONE_KEY]);
  });

  it("sorts by rule with no history", () => {
    const lanes = sortLanes(buildLanes([beta(), alpha()]));
    expect(keys(stableOrder(lanes, []))).toEqual(["a", "b"]);
  });
});

describe("laneSummary", () => {
  it("counts the items of an open lane", () => {
    const [lane] = buildLanes([alpha(), alpha({ state: "running" })]);
    expect(laneSummary(lane!, false)).toBe("2 items");
    expect(laneSummary(buildLanes([alpha()])[0]!, false)).toBe("1 item");
  });

  it("says what a collapsed lane holds, column by column", () => {
    const [lane] = buildLanes([alpha(), alpha(), alpha({ state: "needs_you" }), alpha({ state: "done" })]);
    expect(laneSummary(lane!, true)).toBe("2 ready · 1 needs you · 1 done");
  });
});

describe("dependabotCount", () => {
  it("counts open Dependabot pull requests, not finished ones or other authors", () => {
    const [lane] = buildLanes([
      alpha({ source: "github-pr", author: "dependabot[bot]" }),
      alpha({ source: "github-pr", author: "dependabot[bot]", state: "needs_you" }),
      alpha({ source: "github-pr", author: "dependabot[bot]", state: "done" }),
      alpha({ source: "github-pr", author: "octocat" }),
    ]);
    expect(dependabotCount(lane!)).toBe(2);
  });
});
