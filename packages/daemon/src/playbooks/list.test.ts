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
    expect(r.playbooks.map(({ tools: _t, permissions: _p, ...rest }) => rest)).toEqual([
      { name: "implement", model: "opus", effort: "high", permissionMode: "acceptEdits", drafts: ["pr"], body: "Do {{ title }}.\n", file: join(global, "implement.md"), scope: { kind: "global" } },
      { name: "deps", model: "haiku", permissionMode: "acceptEdits", drafts: ["pr"], body: "Do {{ title }}.\n", file: join(repo, ".donepm", "playbooks", "deps.md"), scope },
      { name: "implement", model: "sonnet", permissionMode: "acceptEdits", drafts: ["pr"], body: "Do {{ title }}.\n", file: join(repo, ".donepm", "playbooks", "implement.md"), scope, overridesGlobal: true },
    ]);
    expect(r.problems.map((p) => p.file)).toEqual([join(global, "bad.md")]);
  });

  it("returns the prompt and match filter, and says whether a shipped playbook was edited (#154)", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-pbl-"));
    const global = join(root, "global");
    const shipped = join(root, "shipped");
    await mkdir(global);
    await mkdir(shipped);
    const review = pb("review", "opus", "read_only: true\nmatch:\n  source: github-pr\n").replace("acceptEdits", "default").replace("[pr]", "[review]");
    await writeFile(join(shipped, "review.md"), review);
    await writeFile(join(shipped, "implement.md"), pb("implement", "opus"));
    await writeFile(join(global, "review.md"), review);
    await writeFile(join(global, "implement.md"), pb("implement", "sonnet"));
    await writeFile(join(global, "mine.md"), pb("mine", "haiku"));

    const r = await listPlaybooks(global, [], [join(shipped, "implement.md"), join(shipped, "review.md"), join(shipped, "gone.md")]);
    expect(r.playbooks.map((p) => [p.name, p.builtIn])).toEqual([["implement", "edited"], ["mine", undefined], ["review", "default"]]);
    expect(r.playbooks.find((p) => p.name === "review")).toMatchObject({
      readOnly: true, drafts: ["review"], match: { source: "github-pr" }, body: "Do {{ title }}.\n", tools: ["whoami", "draft_review", "draft_update_branch"],
    });
    // What the agent may do: the read-only playbook's rules add to both lists (D42).
    const [implement, , rev] = r.playbooks;
    expect(implement!.tools).toEqual(["whoami", "draft_pr", "draft_push", "draft_comment"]);
    expect(implement!.permissions.allow).toEqual(["mcp__donepm"]);
    expect(rev!.permissions.allow.length).toBeGreaterThan(1);
    expect(rev!.permissions.deny.length).toBeGreaterThan(implement!.permissions.deny.length);
  });
});
