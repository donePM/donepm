import { describe, expect, it } from "vitest";
import type { PlaybookEntry, RepoView } from "../../api/types";
import { orphanName, playbookChoices, pollLine, slug, visibleRepos } from "./repos";

const repo = (originUrl: string, path: string, managed: boolean): RepoView => ({
  id: originUrl,
  originUrl,
  path,
  defaultBranch: "main",
  managed,
  worktrees: 0,
} as RepoView);

describe("visibleRepos", () => {
  const repos = [repo("github.com/a/pergament", "/Code/oss/pergament", true), repo("github.com/a/clonio", "/Code/products/clonio", false)];

  it("hides ignored repositories unless they are asked for", () => {
    expect(visibleRepos(repos, "", false).map((r) => r.originUrl)).toEqual(["github.com/a/pergament"]);
    expect(visibleRepos(repos, "", true)).toHaveLength(2);
  });

  it("filters on origin or path, every word, ignoring case", () => {
    expect(visibleRepos(repos, "PRODUCTS", true).map((r) => r.originUrl)).toEqual(["github.com/a/clonio"]);
    expect(visibleRepos(repos, "a/ oss", true).map((r) => r.originUrl)).toEqual(["github.com/a/pergament"]);
    expect(visibleRepos(repos, "nothing", true)).toEqual([]);
  });
});

describe("playbookChoices", () => {
  const pb = (name: string, scope: PlaybookEntry["scope"]): PlaybookEntry => ({
    name, model: "opus", permissionMode: "default", drafts: ["pr"], file: `${name}.md`, scope,
  });
  const list = {
    globalDir: "/pb",
    problems: [],
    playbooks: [
      pb("implement", { kind: "global" }),
      pb("review", { kind: "global" }),
      pb("review", { kind: "repo", repoId: "r1", origin: "github.com/a/b", path: "/b" }),
      pb("other", { kind: "repo", repoId: "r2", origin: "github.com/c/d", path: "/d" }),
    ],
  };

  it("offers the repository's own playbooks, then the global ones it does not replace", () => {
    expect(playbookChoices(list, "github.com/a/b")).toEqual([
      { name: "review", label: "review · opus (this repository)" },
      { name: "implement", label: "implement · opus (global)" },
    ]);
    expect(playbookChoices(list, "github.com/x/y").map((c) => c.name)).toEqual(["implement", "review"]);
    expect(playbookChoices(undefined, "github.com/a/b")).toEqual([]);
  });
});

describe("pollLine", () => {
  it("says how the repository's last poll went", () => {
    expect(pollLine(undefined)).toBeUndefined();
    expect(pollLine({ ok: true, issues: 4 })).toEqual({ text: "last poll ok · 4 issues", failed: false });
    expect(pollLine({ ok: true, issues: 1 })).toEqual({ text: "last poll ok · 1 issue", failed: false });
    expect(pollLine({ ok: false, error: "rate limit" })).toEqual({ text: "query failed · rate limit", failed: true });
  });
});

describe("slug", () => {
  it("drops the host", () => expect(slug("github.com/a/b")).toBe("a/b"));
});

describe("orphanName", () => {
  it("shows the path below the root it is under, current or former", () => {
    expect(orphanName("/w/pergament/dp-37", ["/w"])).toBe("pergament/dp-37");
    expect(orphanName("/old/x/dp-1", ["/w/", "/old"])).toBe("x/dp-1");
    expect(orphanName("/elsewhere/dp-1", ["/w"])).toBe("/elsewhere/dp-1");
  });
});
