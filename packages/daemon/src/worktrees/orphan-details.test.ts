import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { withOrphanDetails } from "./orphan-details.js";

describe("withOrphanDetails", () => {
  it("adds the size from du and the date of the last commit", async () => {
    const exec = fakeExec({
      "du -sk /wt/a": ok("2048\t/wt/a\n"),
      "git -C /wt/a log -1 --format=%cI": ok("2026-09-20T10:00:00+02:00\n"),
    });
    const [o] = await withOrphanDetails(exec, [{ repoId: "r1", repoPath: "/code/a", path: "/wt/a", branch: "dp/1-a" }]);
    expect(o).toEqual({
      repoId: "r1", repoPath: "/code/a", path: "/wt/a", branch: "dp/1-a",
      sizeBytes: 2048 * 1024, lastCommitAt: "2026-09-20T10:00:00+02:00",
    });
  });

  it("leaves out what could not be read", async () => {
    const exec = fakeExec({ "du -sk /wt/b": fail("No such file"), "git -C /wt/b log": fail("no commits") });
    const [o] = await withOrphanDetails(exec, [{ repoId: "r1", repoPath: "/code/a", path: "/wt/b" }]);
    expect(o).toEqual({ repoId: "r1", repoPath: "/code/a", path: "/wt/b" });
  });
});
