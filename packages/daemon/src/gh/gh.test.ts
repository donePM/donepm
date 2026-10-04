import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { detectGh } from "./detect.js";
import { assignIssueToMe, fetchAssignedIssues, fetchIssueState, fetchQueryIssues } from "./issues.js";

describe("detectGh", () => {
  it("not installed when which fails", async () => {
    expect(await detectGh(fakeExec({ "which gh": fail("", 1) }))).toEqual({ state: "not_installed" });
  });

  it("not logged in when gh auth status fails", async () => {
    const exec = fakeExec({
      "which gh": ok("/opt/homebrew/bin/gh\n"),
      "gh auth status": fail(fixture("gh/auth-status-logged-out.stderr")),
    });
    expect(await detectGh(exec)).toEqual({ state: "not_logged_in", path: "/opt/homebrew/bin/gh" });
  });

  it("ready with the account name", async () => {
    const exec = fakeExec({
      "which gh": ok("/opt/homebrew/bin/gh\n"),
      "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
    });
    expect(await detectGh(exec)).toEqual({ state: "ready", path: "/opt/homebrew/bin/gh", account: "octocat" });
  });
});

describe("fetchAssignedIssues", () => {
  it("maps recorded search output to source issues", async () => {
    const exec = fakeExec({ "gh search issues": ok(fixture("gh/search-issues.json")) });
    const r = await fetchAssignedIssues(exec, () => []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toHaveLength(4);
    expect(r.issues[0]).toEqual({
      repository: "acme/widgets",
      number: 161,
      url: "https://github.com/acme/widgets/issues/161",
      title: "[Feature] Support nested relations",
      body: "## Problem to solve\n\nNested relations are not mapped.\n\n## Proposed solution\n\nAdd a mapping key.",
      labels: ["enhancement"],
      createdAt: "2026-09-28T14:02:11Z",
    });
    expect(r.issues[1]!.body).toBe("");
    expect(r.issues[2]!.title).toBe("Prüfung der Eingabe vor dem Speichern");
    expect(exec.calls[0]!.args).toEqual([
      "search", "issues", "--assignee=@me", "--state=open",
      "--json", "number,title,body,createdAt,labels,repository,url", "--limit", "1000",
    ]);
  });

  it("accepts an empty result", async () => {
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": ok(fixture("gh/search-issues-empty.json")) }), () => []);
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it("treats a null body as empty", async () => {
    const raw = JSON.parse(fixture("gh/search-issues.json")) as Array<Record<string, unknown>>;
    raw[0]!.body = null;
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": ok(JSON.stringify(raw)) }), () => []);
    expect(r.ok && r.issues[0]!.body).toBe("");
  });

  it("reports schema failures with the raw output instead of throwing", async () => {
    const raw = JSON.stringify([{ number: "x" }]);
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": ok(raw) }), () => []);
    expect(r).toMatchObject({ ok: false, kind: "schema", raw });
    expect(!r.ok && r.error).toMatch(/number/);
  });

  it("rejects an issue without createdAt", async () => {
    const raw = JSON.parse(fixture("gh/search-issues.json")) as Array<Record<string, unknown>>;
    delete raw[0]!.createdAt;
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": ok(JSON.stringify(raw)) }), () => []);
    expect(!r.ok && r.kind === "schema" && r.error).toMatch(/createdAt/);
  });

  it("reports non-JSON output as a schema failure", async () => {
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": ok("<html>") }), () => []);
    expect(r).toMatchObject({ ok: false, kind: "schema", raw: "<html>" });
  });

  it("reports a failing command", async () => {
    const r = await fetchAssignedIssues(fakeExec({ "gh search issues": fail("HTTP 502: Bad Gateway") }), () => []);
    expect(r).toEqual({ ok: false, kind: "command", error: "HTTP 502: Bad Gateway" });
  });

  it("falls back to gh issue list per known repo when search is unknown", async () => {
    const exec = fakeExec({
      "gh search issues": fail(fixture("gh/search-unknown-command.stderr")),
      "gh issue list": ok(fixture("gh/issue-list.json")),
    });
    const r = await fetchAssignedIssues(exec, () => ["github.com/acme/widgets", "github.com/acme/widgets"]);
    expect(r).toEqual({
      ok: true,
      issues: [
        {
          repository: "acme/widgets",
          number: 69,
          url: "https://github.com/acme/widgets/issues/69",
          title: "Use AI to retrieve data from a stored note",
          body: "Extract tasks from a stored note.",
          labels: [],
          createdAt: "2026-09-20T07:13:29Z",
        },
      ],
    });
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[1]!.args).toContain("github.com/acme/widgets");
  });
});

describe("fetchIssueState", () => {
  it("reads open and closed", async () => {
    expect(await fetchIssueState(fakeExec({ "gh issue view": ok(fixture("gh/issue-view-closed.json")) }), "o/r", 1)).toBe("CLOSED");
    expect(await fetchIssueState(fakeExec({ "gh issue view": ok(fixture("gh/issue-view-open.json")) }), "o/r", 1)).toBe("OPEN");
  });

  it("reads a merged pull request as closed (D40)", async () => {
    expect(await fetchIssueState(fakeExec({ "gh issue view": ok(fixture("gh/issue-view-merged-pr.json")) }), "o/r", 1)).toBe("CLOSED");
  });

  it("is undefined when gh fails", async () => {
    expect(await fetchIssueState(fakeExec({ "gh issue view": fail("GraphQL: Could not resolve") }), "o/r", 1)).toBeUndefined();
  });
});

describe("fetchQueryIssues", () => {
  it("runs the pasted query against one repository and maps the result", async () => {
    const exec = fakeExec({ "gh issue list": ok(fixture("gh/issue-list.json")) });
    const r = await fetchQueryIssues(exec, "github.com/acme/widgets", "is:issue (label:bug OR label:docs) no:assignee");
    expect(r.ok && r.issues.map((i) => [i.repository, i.number])).toEqual([["acme/widgets", 69]]);
    expect(exec.calls[0]!.args).toEqual([
      "issue", "list", "--repo", "github.com/acme/widgets",
      "--search", "is:issue (label:bug OR label:docs) no:assignee", "--state", "open",
      "--json", "number,title,body,createdAt,labels,url", "--limit", "1000",
    ]);
  });

  it("keeps GitHub's spelling of the repository from the issue URL", async () => {
    const raw = JSON.stringify([{ number: 7, title: "T", body: "", labels: [], url: "https://github.com/Acme/API/issues/7", createdAt: "2026-09-01T00:00:00Z" }]);
    const r = await fetchQueryIssues(fakeExec({ "gh issue list": ok(raw) }), "github.com/acme/api", "x");
    expect(r.ok && r.issues[0]!.repository).toBe("Acme/API");
  });

  it("reports a failing command and schema failures", async () => {
    expect(await fetchQueryIssues(fakeExec({ "gh issue list": fail("invalid search query") }), "github.com/o/r", "x"))
      .toEqual({ ok: false, kind: "command", error: "invalid search query" });
    expect(await fetchQueryIssues(fakeExec({ "gh issue list": ok("{}") }), "github.com/o/r", "x"))
      .toMatchObject({ ok: false, kind: "schema", raw: "{}" });
  });
});

describe("assignIssueToMe", () => {
  it("adds the gh user as assignee", async () => {
    const exec = fakeExec({ "gh issue edit": ok("https://github.com/o/r/issues/3\n") });
    expect(await assignIssueToMe(exec, "o/r", 3)).toEqual({ ok: true });
    expect(exec.calls[0]!.args).toEqual(["issue", "edit", "3", "--repo", "o/r", "--add-assignee", "@me"]);
  });

  it("returns gh's error", async () => {
    expect(await assignIssueToMe(fakeExec({ "gh issue edit": fail("HTTP 403: forbidden") }), "o/r", 3))
      .toEqual({ ok: false, error: "HTTP 403: forbidden" });
  });
});
