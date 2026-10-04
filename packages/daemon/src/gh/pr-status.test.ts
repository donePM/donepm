import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchPrStatuses, prStatusQuery } from "./pr-status.js";

describe("fetchPrStatuses (D47)", () => {
  it("reads mergeable, merge state, head, base, reviews and checks of several pull requests in one call", async () => {
    const exec = fakeExec({ "gh api graphql": ok(fixture("gh/pr-status.json")) });
    const read = await fetchPrStatuses(exec, [
      { repository: "donePM/donepm", number: 88 }, { repository: "vuejs/core", number: 15766 }, { repository: "donePM/donepm", number: 129 },
    ]);
    expect(exec.calls).toHaveLength(1);
    expect(Object.fromEntries(read)).toEqual({
      "donePM/donepm#88": { state: "OPEN", mergeable: "UNKNOWN", mergeState: "UNKNOWN", head: "a04f8743f8f8bf5d439f249dc3190a145799bb5b", base: "main", checks: "FAILURE" },
      "vuejs/core#15766": { state: "OPEN", mergeable: "MERGEABLE", mergeState: "UNSTABLE", head: "b24ff550cf076f6a92a92ea269fa78935e9222da", base: "minor", checks: "FAILURE" },
      "donePM/donepm#129": {
        state: "MERGED", closedAt: "2026-10-04T13:38:56Z", mergeable: "UNKNOWN", mergeState: "UNKNOWN", head: "62346880fef0e0dd0f3eeb0a80cea0a637c2670c", base: "main", checks: "SUCCESS",
      },
    });
  });

  it("keeps the answers next to a pull request GitHub cannot find (gh exits 1)", async () => {
    const exec = fakeExec({ "gh api graphql": { code: 1, stdout: fixture("gh/pr-status-not-found.json"), stderr: "gh: Could not resolve" } });
    const read = await fetchPrStatuses(exec, [{ repository: "donePM/donepm", number: 87 }, { repository: "donePM/donepm", number: 99999 }]);
    expect([...read.keys()]).toEqual(["donePM/donepm#87"]);
    expect(read.get("donePM/donepm#87")).toEqual({
      state: "OPEN", mergeable: "MERGEABLE", mergeState: "BEHIND", head: "66d876d7066588704d137b3a93a093df60c4bd39", base: "main", checks: "SUCCESS",
    });
  });

  it("reads nothing when gh fails, and asks nothing for no pull requests or odd names", async () => {
    expect((await fetchPrStatuses(fakeExec({ "gh api graphql": fail("HTTP 502") }), [{ repository: "o/r", number: 1 }])).size).toBe(0);
    const exec = fakeExec({});
    expect((await fetchPrStatuses(exec, [{ repository: 'o"/r', number: 1 }, { repository: "o/r", number: 0 }])).size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  it("names each pull request by an alias in order", () => {
    expect(prStatusQuery([{ repository: "o/r", number: 3 }])).toMatch(/^query \{ pr0: repository\(owner: "o", name: "r"\) \{ pullRequest\(number: 3\) \{ number state closedAt mergeable mergeStateStatus headRefOid /);
  });
});
