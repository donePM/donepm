import { describe, expect, it } from "vitest";
import { issueSearchUrl, withSource } from "./sources";

describe("withSource", () => {
  const base = { "github.com/a/b": { query: "label:x", assignOnStart: false } };

  it("adds or replaces one repository's entry, trimming the query", () => {
    expect(withSource(base, "github.com/c/d", { query: " no:assignee ", assignOnStart: true })).toEqual({
      ...base,
      "github.com/c/d": { query: "no:assignee", assignOnStart: true },
    });
    expect(withSource(base, "github.com/a/b", { query: "", assignOnStart: true })).toEqual({
      "github.com/a/b": { assignOnStart: true },
    });
  });

  it("drops an entry that only holds defaults", () => {
    expect(withSource(base, "github.com/a/b", { query: "  ", assignOnStart: false })).toEqual({});
  });

  it("keeps the managed choice, either way, and the entry that holds only it", () => {
    for (const managed of [true, false]) {
      const chosen = { "github.com/a/b": { query: "label:x", assignOnStart: false, managed } };
      expect(withSource(chosen, "github.com/a/b", { query: "", assignOnStart: false })).toEqual({
        "github.com/a/b": { assignOnStart: false, managed },
      });
    }
  });

  it("sets the managed choice when the form gives one: ignoring a repository is unmanaging it (#127)", () => {
    expect(withSource(base, "github.com/a/b", { query: "label:x", assignOnStart: false, managed: false })).toEqual({
      "github.com/a/b": { query: "label:x", assignOnStart: false, managed: false },
    });
    expect(withSource({}, "github.com/c/d", { query: "", assignOnStart: false, managed: true })).toEqual({
      "github.com/c/d": { assignOnStart: false, managed: true },
    });
  });

  it("keeps a default playbook, and drops an empty one (#127)", () => {
    expect(withSource({}, "github.com/a/b", { query: "", assignOnStart: false, playbook: " implement " })).toEqual({
      "github.com/a/b": { assignOnStart: false, playbook: "implement" },
    });
    expect(withSource({ "github.com/a/b": { assignOnStart: false, playbook: "x" } }, "github.com/a/b", { query: "", assignOnStart: false, playbook: "" })).toEqual({});
  });

  it("keeps the playbooks per ingest, and drops them when they are the defaults (#153)", () => {
    expect(withSource({}, "github.com/c/d", { query: "", assignOnStart: false, playbooks: { pr: ["audit"] } })).toEqual({
      "github.com/c/d": { assignOnStart: false, playbooks: { pr: ["audit"] } },
    });
    expect(withSource({}, "github.com/c/d", { query: "", assignOnStart: false, playbooks: {} })).toEqual({});
  });

  it("keeps the config file's Azure Pipelines opt-in (#143)", () => {
    const ci = { source: "azure-pipelines" as const, definitions: [41], organization: "acme", project: "Platform" };
    expect(withSource({ "github.acme.com/team/api": { assignOnStart: true, ci } }, "github.acme.com/team/api", { query: "", assignOnStart: false })).toEqual({
      "github.acme.com/team/api": { assignOnStart: false, ci },
    });
  });
});

describe("issueSearchUrl", () => {
  it("opens the repository's issue search with the query, or the default one", () => {
    expect(issueSearchUrl("github.com/a/b", "is:issue (label:bug OR label:docs)")).toBe(
      "https://github.com/a/b/issues?q=is%3Aissue%20(label%3Abug%20OR%20label%3Adocs)",
    );
    expect(issueSearchUrl("github.com/a/b", "")).toBe("https://github.com/a/b/issues?q=is%3Aissue%20state%3Aopen%20assignee%3A%40me");
  });

  it("keeps the merge settings of others' pull requests only when they differ from the defaults (D47)", () => {
    expect(withSource({}, "github.com/a/b", { query: "", assignOnStart: false, autoMerge: false, mergeMethod: "squash" })).toEqual({});
    expect(withSource({}, "github.com/a/b", { query: "", assignOnStart: false, autoMerge: true, mergeMethod: "rebase" })).toEqual({
      "github.com/a/b": { assignOnStart: false, autoMerge: true, mergeMethod: "rebase" },
    });
  });
});
