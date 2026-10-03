import { describe, expect, it } from "vitest";
import type { Playbook } from "./schema.js";
import { playbookMatches, selectPlaybook } from "./select.js";

const pb = (name: string, match?: Playbook["match"]): Playbook => ({
  name, model: "opus", permissionMode: "plan", drafts: ["pr"], body: "x", ...(match ? { match } : {}),
});
const it1 = { source: "github-issue" as const, labels: ["Bug"] };

describe("playbookMatches", () => {
  it("no match fits everything", () => expect(playbookMatches(pb("a"), it1)).toBe(true));
  it("source must equal", () => {
    expect(playbookMatches(pb("a", { source: "github-issue" }), it1)).toBe(true);
    expect(playbookMatches(pb("a", { source: "jira" }), it1)).toBe(false);
  });
  it("labels: any of, case-insensitive", () => {
    expect(playbookMatches(pb("a", { labels: ["bug", "x"] }), it1)).toBe(true);
    expect(playbookMatches(pb("a", { labels: ["x"] }), it1)).toBe(false);
  });
  it("source and labels both must fit", () => {
    expect(playbookMatches(pb("a", { source: "jira", labels: ["bug"] }), it1)).toBe(false);
  });
});

describe("selectPlaybook", () => {
  it("one candidate", () => {
    const r = selectPlaybook(it1, [pb("a", { source: "github-issue" }), pb("b", { source: "jira" })]);
    expect(r.selected?.name).toBe("a");
    expect(r.candidates).toHaveLength(1);
  });
  it("several: first by name, regardless of input order", () => {
    const r = selectPlaybook(it1, [pb("zeta"), pb("alpha"), pb("mid")]);
    expect(r.selected?.name).toBe("alpha");
    expect(r.candidates.map((p) => p.name)).toEqual(["alpha", "mid", "zeta"]);
  });
  it("none", () => {
    const r = selectPlaybook(it1, [pb("a", { labels: ["x"] })]);
    expect(r.selected).toBeUndefined();
    expect(r.candidates).toEqual([]);
  });
  it("does not mutate input", () => {
    const list = [pb("b"), pb("a")];
    selectPlaybook(it1, list);
    expect(list.map((p) => p.name)).toEqual(["b", "a"]);
  });
});
