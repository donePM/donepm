import { filteredPath } from "./path.js";

/** Variables `gh`, `glab` and `jira` read their credentials from. The agent never sees them. */
export const TOKEN_VARIABLES = [
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
  "GLAB_TOKEN", "GITLAB_TOKEN", "JIRA_API_TOKEN",
] as const;

/** The daemon's environment without tokens, with a `PATH` that has no `gh`/`glab`/`jira`. */
export async function agentEnv(base: NodeJS.ProcessEnv, shimRoot: string): Promise<NodeJS.ProcessEnv> {
  const env = { ...base };
  for (const name of TOKEN_VARIABLES) delete env[name];
  env.PATH = await filteredPath(base.PATH ?? "", shimRoot);
  return env;
}
