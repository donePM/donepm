import { mkdir, mkdtemp, readlink, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { filteredPath } from "./path.js";

async function bin(root: string, name: string, files: string[]): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeFile(join(dir, f), "#!/bin/sh\n", { mode: 0o755 });
  return dir;
}

describe("filteredPath", () => {
  it("keeps clean directories and replaces ones holding gh with a filtered copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-path-"));
    const clean = await bin(root, "usr-bin", ["git", "ls"]);
    const brew = await bin(root, "brew-bin", ["gh", "node", "pnpm", "glab"]);
    const shims = join(root, "shims");

    const path = await filteredPath([clean, brew, join(root, "missing")].join(delimiter), shims);
    const [first, second, third] = path.split(delimiter);
    expect(first).toBe(clean);
    expect(second!.startsWith(shims)).toBe(true);
    expect(third).toBe(join(root, "missing"));
    expect((await readdir(second!)).sort()).toEqual(["node", "pnpm"]);
    expect(await readlink(join(second!, "node"))).toBe(join(brew, "node"));
  });

  it("picks up commands installed since the last run", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-path-"));
    const brew = await bin(root, "brew-bin", ["gh", "node"]);
    const shims = join(root, "shims");
    await filteredPath(brew, shims);
    await writeFile(join(brew, "pnpm"), "");
    const dir = await filteredPath(brew, shims);
    expect((await readdir(dir)).sort()).toEqual(["node", "pnpm"]);
  });

  it("leaves az out, so an agent cannot reach Azure DevOps (issue #141)", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-path-"));
    const sdk = await bin(root, "azure-cli-bin", ["az", "python3"]);
    const dir = await filteredPath(sdk, join(root, "shims"));
    expect(dir).not.toBe(sdk);
    expect(await readdir(dir)).toEqual(["python3"]);
  });
});
