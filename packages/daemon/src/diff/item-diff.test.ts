import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec } from "../process/exec.js";
import { itemDiff } from "./item-diff.js";

let dir: string;
const git = async (...args: string[]) => {
  const r = await exec("git", args, { cwd: dir });
  if (r.code !== 0) throw new Error(r.stderr);
  return r.stdout;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "donepm-diff-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "T");
  await git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  await git("add", ".");
  await git("commit", "-qm", "base");
  await git("checkout", "-qb", "dp/1-x");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("itemDiff", () => {
  it("shows commits on the branch, uncommitted and untracked changes against the base", async () => {
    writeFileSync(join(dir, "a.txt"), "one\nTWO\n");
    await git("commit", "-qam", "change a");
    await git("checkout", "-q", "main");
    writeFileSync(join(dir, "main-only.txt"), "later on main\n");
    await git("add", ".");
    await git("commit", "-qm", "main moved on");
    await git("checkout", "-q", "dp/1-x");
    writeFileSync(join(dir, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(join(dir, "new.txt"), "hello\n");

    const d = await itemDiff(exec, { worktreePath: dir, branch: "dp/1-x", defaultBranch: "main" });

    expect(d).toMatchObject({ base: "main", branch: "dp/1-x", commits: 1 });
    expect(d.patch).toContain("diff --git a/a.txt b/a.txt");
    expect(d.patch).toContain("+TWO");
    expect(d.patch).toContain("+three");
    expect(d.patch).toContain("+hello");
    expect(d.patch).toMatch(/\+\+\+ b\/new\.txt/);
    // Changes that only happened on the base are not the branch's.
    expect(d.patch).not.toContain("main-only");
  });

  it("is empty for a fresh branch and skips ignored files", async () => {
    writeFileSync(join(dir, ".gitignore"), "ignored/\n");
    const d = await itemDiff(exec, { worktreePath: dir, branch: "dp/1-x", defaultBranch: "main" });
    expect(d).toEqual({ base: "main", branch: "dp/1-x", commits: 0, patch: "" });
  });
});
