import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

  it("drops GitHub Enterprise tokens and the gh host (issue #140)", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-env-"));
    const env = await agentEnv(
      { PATH: "", HOME: "/home/x", GH_ENTERPRISE_TOKEN: "t", GITHUB_ENTERPRISE_TOKEN: "t", GH_HOST: "github.acme.com" },
      { shimRoot: join(root, "shims"), emptyConfigDir: join(root, "no-config") },
    );
    expect(Object.keys(env).sort()).toEqual(["GH_CONFIG_DIR", "GLAB_CONFIG_DIR", "HOME", "PATH"]);
  });

  it("drops what a node --watch or pnpm run of the daemon leaves in its environment (#115)", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-env-"));
    // A directory without gh, so filteredPath keeps it as it is.
    const bin = join(root, "bin");
    await mkdir(bin);
    const env = await agentEnv(
      {
        PATH: ["/repo/donepm/node_modules/.bin", "/repo/donepm/packages/daemon/node_modules/.bin", "node_modules/.bin", bin].join(delimiter),
        HOME: "/home/x", NODE_OPTIONS: "--max-old-space-size=8192",
        WATCH_REPORT_DEPENDENCIES: "1", NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "json", NODE_UNIQUE_ID: "1",
        NODE_PATH: "/repo/donepm/node_modules/.pnpm/node_modules", NODE: "/bin/node", INIT_CWD: "/repo/donepm",
        npm_lifecycle_event: "dev", npm_config_user_agent: "pnpm/12", NPM_CONFIG_PREFIX: "/x",
        PNPM_PACKAGE_NAME: "donepm", PNPM_SCRIPT_SRC_DIR: "/repo/donepm", pnpm_config_verify_deps_before_run: "false",
      },
      { shimRoot: join(root, "shims"), emptyConfigDir: join(root, "no-config") },
    );
    expect(env).toEqual({
      HOME: "/home/x", NODE_OPTIONS: "--max-old-space-size=8192",
      PATH: ["node_modules/.bin", bin].join(delimiter),
      GH_CONFIG_DIR: join(root, "no-config"), GLAB_CONFIG_DIR: join(root, "no-config"),
    });
  });
});
