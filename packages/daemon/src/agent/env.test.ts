import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentEnv } from "./env.js";

describe("agentEnv", () => {
  it("drops tokens and filters PATH, keeps everything else", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-env-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), "");
    await writeFile(join(bin, "node"), "");
    const env = await agentEnv(
      { PATH: bin, HOME: "/home/x", GH_TOKEN: "t", GITHUB_TOKEN: "t", GITLAB_TOKEN: "t", JIRA_API_TOKEN: "t" },
      { shimRoot: join(root, "shims"), emptyConfigDir: join(root, "no-config") },
    );
    expect(env).toEqual({
      HOME: "/home/x", PATH: expect.any(String),
      GH_CONFIG_DIR: join(root, "no-config"), GLAB_CONFIG_DIR: join(root, "no-config"),
    });
    expect(await readdir(join(root, "no-config"))).toEqual([]);
    expect(env.PATH).not.toContain(bin);
  });
});
