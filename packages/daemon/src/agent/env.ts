import { mkdir } from "node:fs/promises";
import { filteredPath } from "./path.js";

/** Variables `gh`, `glab` and `jira` read their credentials from. The agent never sees them. */
export const TOKEN_VARIABLES = [
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
  "GLAB_TOKEN", "GITLAB_TOKEN", "JIRA_API_TOKEN",
] as const;

/** Where `gh` and `glab` look for their logins. Pointed at an empty directory for the agent. */
export const CONFIG_DIR_VARIABLES = ["GH_CONFIG_DIR", "GLAB_CONFIG_DIR"] as const;

/**
 * The daemon's environment without tokens, with a `PATH` that has no `gh`/`glab`/`jira`, and with
 * `gh`/`glab` configured from an empty directory: called by absolute path, or as git's credential
 * helper, they find no login (#16).
 */
export async function agentEnv(base: NodeJS.ProcessEnv, dirs: { shimRoot: string; emptyConfigDir: string }): Promise<NodeJS.ProcessEnv> {
  const env = { ...base };
  for (const name of TOKEN_VARIABLES) delete env[name];
  env.PATH = await filteredPath(base.PATH ?? "", dirs.shimRoot);
  await mkdir(dirs.emptyConfigDir, { recursive: true, mode: 0o700 });
  for (const name of CONFIG_DIR_VARIABLES) env[name] = dirs.emptyConfigDir;
  return env;
}
