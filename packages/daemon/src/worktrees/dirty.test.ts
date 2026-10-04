import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec } from "../process/exec.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { porcelainPaths, uncommittedChanges } from "./dirty.js";

describe("porcelainPaths", () => {
  it("reads paths and skips the source of a rename", () => {
    expect(porcelainPaths(" M a.ts\0?? dir/b.ts\0R  new.ts\0old.ts\0")).toEqual(["a.ts", "dir/b.ts", "new.ts"]);
    expect(porcelainPaths("")).toEqual([]);
  });
});

describe("uncommittedChanges", () => {
  it("lists changed and untracked files but not what setup copied in", async () => {
    const { clone } = await cloneWithOrigin({ ".donepm/setup.yml": "copy:\n  - .env.local\n" });
    expect(await uncommittedChanges(exec, clone)).toEqual([]);
    await writeFile(join(clone, ".env.local"), "SECRET=1\n");
    expect(await uncommittedChanges(exec, clone)).toEqual([]);
    await mkdir(join(clone, "src"));
    await writeFile(join(clone, "src", "new.ts"), "x\n");
    await writeFile(join(clone, "README.md"), "changed\n");
    expect((await uncommittedChanges(exec, clone)).sort()).toEqual(["README.md", "src/new.ts"]);
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "wip");
    expect(await uncommittedChanges(exec, clone)).toEqual([]);
  });

  it("throws when git cannot read the directory", async () => {
    await expect(uncommittedChanges(exec, "/nonexistent/donepm")).rejects.toThrow(/git status failed/);
  });
});
