import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchPriorityFields, issueFieldsQuery, withPriorityFields } from "./issue-fields.js";
import type { FetchedIssue } from "./schema.js";

const ids = ["I_kwDOredacted161", "I_kwDOredacted157", "I_kwDOredacted61", "I_kwDOredacted12"];

function issue(number: number, extra: Partial<FetchedIssue> = {}): FetchedIssue {
  return {
    nodeId: `I_kwDOredacted${number}`, repository: "acme/widgets", number, url: `https://github.com/acme/widgets/issues/${number}`,
    title: `#${number}`, body: "", labels: [], createdAt: "2026-09-01T08:00:00Z", ...extra,
  };
}

describe("fetchPriorityFields", () => {
  it("reads the Priority option per issue from recorded output", async () => {
    const exec = fakeExec({ "gh api graphql": ok(fixture("gh/issue-fields.json")) });
    const fields = await fetchPriorityFields(exec, ids);
    expect([...fields]).toEqual([
      ["I_kwDOredacted161", "Medium"],
      ["I_kwDOredacted157", "Low"],
      ["I_kwDOredacted61", null],
      ["I_kwDOredacted12", null],
    ]);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]!.args).toEqual(["api", "graphql", "--hostname", "github.com", "-f", `query=${issueFieldsQuery(ids)}`]);
  });

  it("asks once per 100 issues", async () => {
    const exec = fakeExec({ "gh api graphql": ok('{"data":{"nodes":[]}}') });
    await fetchPriorityFields(exec, Array.from({ length: 201 }, (_, i) => `I_${i}`));
    expect(exec.calls).toHaveLength(3);
  });

  it("keeps the nodes that resolved when one did not (gh exits 1)", async () => {
    const exec = fakeExec({ "gh api graphql": { code: 1, stdout: fixture("gh/issue-fields-not-found.json"), stderr: "gh: Could not resolve" } });
    const fields = await fetchPriorityFields(exec, ["I_kwDOredacted161", "I_nonexistent"]);
    expect([...fields]).toEqual([["I_kwDOredacted161", "Medium"]]);
  });

  it("reads a GitHub without issue fields as no fields", async () => {
    const exec = fakeExec({
      "gh api graphql": { code: 1, stdout: fixture("gh/issue-fields-unsupported.json"), stderr: "gh: Field 'issueFieldValues' doesn't exist on type 'Issue'" },
    });
    expect([...(await fetchPriorityFields(exec, ["I_a"]))]).toEqual([["I_a", null]]);
  });

  it("reads nothing when gh fails", async () => {
    const exec = fakeExec({ "gh api graphql": fail("HTTP 502") });
    expect((await fetchPriorityFields(exec, ["I_a"])).size).toBe(0);
  });

  it("never puts an odd id into the query", async () => {
    const exec = fakeExec({ "gh api graphql": ok('{"data":{"nodes":[]}}') });
    await fetchPriorityFields(exec, ['x"]) { evil }']);
    expect(exec.calls).toHaveLength(0);
  });
});

describe("withPriorityFields", () => {
  it("sets the field option, leaves issues without one and pull requests alone", async () => {
    const exec = fakeExec({ "gh api graphql": ok(fixture("gh/issue-fields.json")) });
    const pr = issue(5, { nodeId: "PR_x", source: "github-pr", labels: ["P1"] });
    const out = await withPriorityFields(exec, [issue(161), issue(61), pr]);
    expect(out.map((i) => [i.number, i.priorityField, i.priorityUnread])).toEqual([
      [161, "Medium", undefined],
      [61, undefined, undefined],
      [5, undefined, undefined],
    ]);
    expect(out.every((i) => !("nodeId" in i))).toBe(true);
    expect(exec.calls[0]!.args[5]).not.toContain("PR_x");
  });

  it("asks each GitHub host for its own issues (issue #140)", async () => {
    const exec = fakeExec({
      "gh api graphql --hostname github.com": ok(fixture("gh/issue-fields.json")),
      // A GitHub Enterprise Server without issue fields.
      "gh api graphql --hostname github.acme.com": {
        code: 1, stdout: fixture("gh/issue-fields-unsupported.json"), stderr: "gh: Field 'issueFieldValues' doesn't exist on type 'Issue'",
      },
    });
    const ghe = issue(7, { nodeId: "I_kwDOghe7", repository: "team/app", url: "https://github.acme.com/team/app/issues/7" });
    const out = await withPriorityFields(exec, [issue(161), ghe]);
    expect(exec.calls.map((c) => c.args.slice(0, 4))).toEqual([
      ["api", "graphql", "--hostname", "github.com"],
      ["api", "graphql", "--hostname", "github.acme.com"],
    ]);
    expect(exec.calls[1]!.args[5]).toContain("I_kwDOghe7");
    expect(exec.calls[1]!.args[5]).not.toContain("I_kwDOredacted161");
    expect(out.map((i) => [i.number, i.priorityField, i.priorityUnread])).toEqual([
      [161, "Medium", undefined],
      [7, undefined, undefined],
    ]);
  });

  it("marks issues whose fields could not be read", async () => {
    const exec = fakeExec({ "gh api graphql": fail("HTTP 502") });
    const out = await withPriorityFields(exec, [issue(161)]);
    expect(out[0]).toMatchObject({ number: 161, priorityUnread: true });
  });

  it("makes no call without issues", async () => {
    const exec = fakeExec({});
    expect(await withPriorityFields(exec, [])).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });
});
