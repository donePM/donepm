import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listPlaybooks } from "./list.js";

const pb = (name: string, model: string, extra = "") =>
  `---\nname: ${name}\nmodel: ${model}\npermission_mode: acceptEdits\ndrafts: [pr]\n${extra}---\nDo {{ title }}.\n`;

describe("listPlaybooks", () => {
  it("lists global playbooks and each repository's own, marking overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-pbl-"));
    const global = join(root, "global");
    const repo = join(root, "widgets");
    await mkdir(global);
    await mkdir(join(repo, ".donepm", "playbooks"), { recursive: true });
    await writeFile(join(global, "implement.md"), pb("implement", "opus", "effort: high\n"));
    await writeFile(join(global, "bad.md"), "no frontmatter");
    await writeFile(join(repo, ".donepm", "playbooks", "implement.md"), pb("implement", "sonnet"));
    await writeFile(join(repo, ".donepm", "playbooks", "deps.md"), pb("deps", "haiku"));

    const r = await listPlaybooks(global, [
      { id: "r1", path: repo, originUrl: "github.com/acme/widgets" },
      { id: "r2", path: join(root, "none"), originUrl: "github.com/acme/none" },
    ]);
    const scope = { kind: "repo", repoId: "r1", origin: "github.com/acme/widgets", path: repo };
    expect(r.globalDir).toBe(global);
    expect(r.playbooks).toEqual([
      { name: "implement", model: "opus", effort: "high", permissionMode: "acceptEdits", drafts: ["pr"], file: join(global, "implement.md"), scope: { kind: "global" } },
      { name: "deps", model: "haiku", permissionMode: "acceptEdits", drafts: ["pr"], file: join(repo, ".donepm", "playbooks", "deps.md"), scope },
      { name: "implement", model: "sonnet", permissionMode: "acceptEdits", drafts: ["pr"], file: join(repo, ".donepm", "playbooks", "implement.md"), scope, overridesGlobal: true },
    ]);
    expect(r.problems.map((p) => p.file)).toEqual([join(global, "bad.md")]);
  });
});
