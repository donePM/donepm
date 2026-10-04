import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlaybookCatalog } from "./catalog.js";

const pb = (name: string) => `---\nname: ${name}\nmodel: opus\npermission_mode: acceptEdits\ndrafts: [pr]\n---\nDo {{ title }}.\n`;

async function dirs() {
  const root = await mkdtemp(join(tmpdir(), "donepm-cat-"));
  const global = join(root, "global");
  const repo = join(root, "repo");
  await mkdir(global);
  await mkdir(join(repo, ".donepm", "playbooks"), { recursive: true });
  await writeFile(join(global, "implement.md"), pb("implement"));
  await writeFile(join(repo, ".donepm", "playbooks", "fix.md"), pb("fix"));
  return { global, repo };
}

const names = (c: PlaybookCatalog, repo?: string) => c.get(repo).map((p) => p.name).sort();

describe("PlaybookCatalog (#153)", () => {
  it("knows nothing before the first load, then the global set for repositories not loaded yet", async () => {
    const d = await dirs();
    const c = new PlaybookCatalog(d.global);
    expect(c.get(d.repo)).toEqual([]);
    await c.load();
    expect(names(c, d.repo)).toEqual(["implement"]);
    await c.load(d.repo);
    expect(names(c, d.repo)).toEqual(["fix", "implement"]);
    expect(names(c)).toEqual(["implement"]);
  });

  it("reads every set again on refresh and forgets repositories that are gone", async () => {
    const d = await dirs();
    const c = new PlaybookCatalog(d.global);
    await c.refresh([d.repo]);
    expect(names(c, d.repo)).toEqual(["fix", "implement"]);
    await writeFile(join(d.global, "audit.md"), pb("audit"));
    await rm(join(d.repo, ".donepm", "playbooks", "fix.md"));
    await c.refresh([]);
    expect(names(c)).toEqual(["audit", "implement"]);
    expect(names(c, d.repo)).toEqual(["audit", "implement"]);
  });
});
