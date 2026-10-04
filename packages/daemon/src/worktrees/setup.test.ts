import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exec } from "../process/exec.js";
import { runSetup, type SetupStep } from "./setup.js";

async function dirs(setupYml?: string) {
  const root = await mkdtemp(join(tmpdir(), "donepm-setup-"));
  const repoPath = join(root, "repo");
  const worktree = join(root, "wt");
  await mkdir(repoPath);
  await mkdir(join(worktree, ".donepm"), { recursive: true });
  if (setupYml !== undefined) await writeFile(join(worktree, ".donepm", "setup.yml"), setupYml);
  const steps: SetupStep[] = [];
  const run = () => runSetup({ exec, repoPath, worktree, report: (s) => steps.push(s) });
  return { repoPath, worktree, steps, run };
}

describe("runSetup", () => {
  it("does nothing without a setup file", async () => {
    const d = await dirs();
    expect(await d.run()).toBe(true);
    expect(d.steps).toEqual([]);
  });

  it("copies files from the main clone, then runs commands in the worktree", async () => {
    const d = await dirs("copy:\n  - .env\n  - storage/key\nrun:\n  - echo built > out.txt\n  - pwd\n");
    await writeFile(join(d.repoPath, ".env"), "SECRET=1");
    await mkdir(join(d.repoPath, "storage"));
    await writeFile(join(d.repoPath, "storage", "key"), "k");
    expect(await d.run()).toBe(true);
    expect(await readFile(join(d.worktree, ".env"), "utf8")).toBe("SECRET=1");
    expect(await readFile(join(d.worktree, "storage", "key"), "utf8")).toBe("k");
    expect(await readFile(join(d.worktree, "out.txt"), "utf8")).toBe("built\n");
    expect(d.steps.map((s) => [s.step, s.ok])).toEqual([["copy", true], ["copy", true], ["run", true], ["run", true]]);
    expect(d.steps[3]).toMatchObject({ command: "pwd", code: 0, stdout: expect.stringContaining("wt") });
  });

  it("stops at the first failing command and reports its output", async () => {
    const d = await dirs("run:\n  - echo oops >&2; exit 3\n  - echo never\n");
    expect(await d.run()).toBe(false);
    expect(d.steps).toEqual([
      { type: "donepm_setup", step: "run", command: "echo oops >&2; exit 3", ok: false, code: 3, stdout: "", stderr: "oops\n" },
    ]);
  });

  it("fails on a missing file to copy", async () => {
    const d = await dirs("copy: [.env]\n");
    expect(await d.run()).toBe(false);
    expect(d.steps[0]).toMatchObject({ step: "copy", file: ".env", ok: false });
  });

  it("skips dependencies with dependencies: off", async () => {
    const d = await dirs("dependencies: off\nrun: [pwd]\n");
    await writeFile(join(d.worktree, "pnpm-lock.yaml"), "");
    expect(await d.run()).toBe(true);
    expect(d.steps.map((s) => s.step)).toEqual(["run"]);
  });

  it("fails on an invalid setup file", async () => {
    const d = await dirs("copy: [../../etc/passwd]\n");
    expect(await d.run()).toBe(false);
    expect(d.steps[0]).toMatchObject({ step: "config", ok: false });
  });
});
