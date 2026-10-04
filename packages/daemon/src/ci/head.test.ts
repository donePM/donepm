import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { worktreeHead } from "./head.js";

const SHA = "b60280bc6e62e2f880f1b63c1e24987664d3bda3";

describe("worktreeHead (issue #143)", () => {
  it("asks git in the worktree for its commit", async () => {
    const exec = fakeExec({ "git rev-parse HEAD": ok(`${SHA}\n`) });
    expect(await worktreeHead(exec, "/w/7")).toBe(SHA);
    expect(exec.calls).toEqual([{ cmd: "git", args: ["rev-parse", "HEAD"], opts: { cwd: "/w/7" } }]);
  });

  it("cannot tell without a worktree, or when git cannot", async () => {
    expect(await worktreeHead(fakeExec({}), undefined)).toBeUndefined();
    expect(await worktreeHead(fakeExec({ "git rev-parse HEAD": fail("fatal: not a git repository") }), "/gone")).toBeUndefined();
  });
});
