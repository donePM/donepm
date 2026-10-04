import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDefaultPlaybooks, loadPlaybooks } from "./load.js";

const pb = (name: string, model: string) =>
  `---\nname: ${name}\nmodel: ${model}\npermission_mode: acceptEdits\ndrafts: [pr]\n---\nDo {{ title }}.\n`;

async function dirs() {
  const root = await mkdtemp(join(tmpdir(), "donepm-pb-"));
  const global = join(root, "global");
  const repo = join(root, "repo");
  await mkdir(global);
  await mkdir(join(repo, ".donepm", "playbooks"), { recursive: true });
  return { root, global, repo };
}

describe("loadPlaybooks", () => {
  it("lets a repo playbook replace a global one of the same name", async () => {
    const d = await dirs();
    await writeFile(join(d.global, "implement.md"), pb("implement", "opus"));
    await writeFile(join(d.global, "review.md"), pb("review", "sonnet"));
    await writeFile(join(d.repo, ".donepm", "playbooks", "implement.md"), pb("implement", "haiku"));
    const { playbooks, problems } = await loadPlaybooks(d.global, d.repo);
    expect(playbooks.map((p) => [p.name, p.model])).toEqual([["implement", "haiku"], ["review", "sonnet"]]);
    expect(problems).toEqual([]);
  });

  it("reports broken files and ignores other files and missing folders", async () => {
    const d = await dirs();
    await writeFile(join(d.global, "broken.md"), "---\nname: x\n---\nbody");
    await writeFile(join(d.global, "notes.txt"), "not a playbook");
    const { playbooks, problems } = await loadPlaybooks(d.global, join(d.root, "nope"));
    expect(playbooks).toEqual([]);
    expect(problems).toEqual([{ file: join(d.global, "broken.md"), error: expect.stringMatching(/Invalid playbook/) }]);
  });
});

describe("ensureDefaultPlaybooks", () => {
  it("writes each default once and never overwrites the user's copy", async () => {
    const d = await dirs();
    const implement = join(d.root, "implement.md");
    const review = join(d.root, "review.md");
    await writeFile(implement, "default");
    await writeFile(review, "default review");
    const target = join(d.root, "config", "playbooks");
    await ensureDefaultPlaybooks(target, [implement]);
    expect(await readFile(join(target, "implement.md"), "utf8")).toBe("default");
    await writeFile(join(target, "implement.md"), "mine");
    await ensureDefaultPlaybooks(target, [implement, review]);
    expect(await readFile(join(target, "implement.md"), "utf8")).toBe("mine");
    expect(await readFile(join(target, "review.md"), "utf8")).toBe("default review");
  });
});
