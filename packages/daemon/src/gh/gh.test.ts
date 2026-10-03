import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { detectGh } from "./detect.js";
import { fetchAssignedIssues, fetchIssueState } from "./issues.js";

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
    });
    expect(r.issues[1]!.body).toBe("");
    expect(r.issues[2]!.title).toBe("Prüfung der Eingabe vor dem Speichern");
    expect(exec.calls[0]!.args).toEqual([
      "search", "issues", "--assignee=@me", "--state=open",
      "--json", "number,title,body,labels,repository,url", "--limit", "1000",
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

  it("is undefined when gh fails", async () => {
    expect(await fetchIssueState(fakeExec({ "gh issue view": fail("GraphQL: Could not resolve") }), "o/r", 1)).toBeUndefined();
  });
});
