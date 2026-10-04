import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchPrStatuses, prStatusQuery } from "./pr-status.js";

describe("fetchPrStatuses (D47)", () => {
  it("reads mergeable, base, reviews and checks of several pull requests in one call", async () => {
    const exec = fakeExec({ "gh api graphql": ok(fixture("gh/pr-status.json")) });
    const read = await fetchPrStatuses(exec, [{ repository: "donePM/donepm", number: 88 }, { repository: "vuejs/core", number: 15766 }]);
    expect(exec.calls).toHaveLength(1);
    expect(Object.fromEntries(read)).toEqual({
      "donePM/donepm#88": { mergeable: "MERGEABLE", base: "main", checks: "FAILURE" },
      "vuejs/core#15766": { mergeable: "MERGEABLE", base: "minor", checks: "FAILURE" },
    });
  });

  it("keeps the answers next to a pull request GitHub cannot find (gh exits 1)", async () => {
    const exec = fakeExec({ "gh api graphql": { code: 1, stdout: fixture("gh/pr-status-not-found.json"), stderr: "gh: Could not resolve" } });
    const read = await fetchPrStatuses(exec, [{ repository: "donePM/donepm", number: 87 }, { repository: "donePM/donepm", number: 99999 }]);
    expect([...read.keys()]).toEqual(["donePM/donepm#87"]);
    expect(read.get("donePM/donepm#87")).toEqual({ mergeable: "UNKNOWN", base: "main", checks: "SUCCESS" });
  });

  it("reads nothing when gh fails, and asks nothing for no pull requests or odd names", async () => {
    expect((await fetchPrStatuses(fakeExec({ "gh api graphql": fail("HTTP 502") }), [{ repository: "o/r", number: 1 }])).size).toBe(0);
    const exec = fakeExec({});
    expect((await fetchPrStatuses(exec, [{ repository: 'o"/r', number: 1 }, { repository: "o/r", number: 0 }])).size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  it("names each pull request by an alias in order", () => {
    expect(prStatusQuery([{ repository: "o/r", number: 3 }])).toMatch(/^query \{ pr0: repository\(owner: "o", name: "r"\) \{ pullRequest\(number: 3\) \{ number mergeable /);
  });
});
