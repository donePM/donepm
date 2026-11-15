import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { createPr, prResult } from "./pr-create.js";

const input = { origin: "github.com/o/r", head: "dp/1-fix", base: "main", title: "Fix", body: "Closes #1", cwd: "/wt/1" };

describe("prResult", () => {
  it("takes the URL from the last line", () => {
    expect(prResult("Warning: 1 uncommitted change\nhttps://github.com/o/r/pull/7\n")).toEqual({ url: "https://github.com/o/r/pull/7", number: 7 });
  });

  it("is undefined without a pull request URL", () => {
    expect(prResult("something else\n")).toBeUndefined();
  });
});

describe("createPr", () => {
  it("runs gh pr create in the worktree with the body in a file", async () => {
    const exec = fakeExec({ "gh pr create": ok("https://github.com/o/r/pull/42\n") });
    expect(await createPr(exec, input)).toEqual({ ok: true, pr: { url: "https://github.com/o/r/pull/42", number: 42 } });
    const call = exec.calls[0]!;
    expect(call.args.slice(0, 11)).toEqual(["pr", "create", "--repo", "github.com/o/r", "--head", "dp/1-fix", "--base", "main", "--title", "Fix", "--body-file"]);
    expect(call.opts?.cwd).toBe("/wt/1");
  });

  it("reports what gh printed on failure", async () => {
    const exec = fakeExec({ "gh pr create": fail("a pull request already exists") });
    expect(await createPr(exec, input)).toEqual({ ok: false, error: "gh pr create failed: a pull request already exists" });
  });

  it("fails when gh printed no pull request URL", async () => {
    const exec = fakeExec({ "gh pr create": ok("") });
    expect(await createPr(exec, input)).toEqual({ ok: false, error: "gh pr create printed no pull request URL: (nothing)" });
  });
});
