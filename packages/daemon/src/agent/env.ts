import { mkdir } from "node:fs/promises";
import { delimiter, isAbsolute, sep } from "node:path";
import { filteredPath } from "./path.js";

/** Variables `gh`, `glab` and `jira` read their credentials from. The agent never sees them. */
export const TOKEN_VARIABLES = [
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
  "GLAB_TOKEN", "GITLAB_TOKEN", "JIRA_API_TOKEN",
  // `az devops` and Atlassian's `acli` (D50).
  "AZURE_DEVOPS_EXT_PAT", "ATLASSIAN_API_TOKEN",
] as const;

/**
 * Which GitHub host `gh` talks to (issue #140). Not a secret, but the agent has no business with a
 * GitHub host: dropped with the tokens. The empty config directory below holds no login for any
 * host, github.com or GitHub Enterprise alike.
 */
export const HOST_VARIABLES = ["GH_HOST"] as const;

/** Where `gh` and `glab` look for their logins. Pointed at an empty directory for the agent. */
export const CONFIG_DIR_VARIABLES = ["GH_CONFIG_DIR", "GLAB_CONFIG_DIR", "AZURE_CONFIG_DIR"] as const;

/**
 * Variables that describe how the daemon itself was started, not the user's machine (#115).
 *
 * `node --watch` (pnpm dev) sets `WATCH_REPORT_DEPENDENCIES`, which makes every Node process below
 * report its imports over `process.send`. vitest's fork workers then talk garbage on their IPC
 * channel, the run aborts, and workers left behind once ran into gigabytes each and took the
 * machine down. The `NODE_CHANNEL_*` and cluster variables belong to the same kind of IPC. The
 * rest is what pnpm, npm and concurrently set for a script run of the donePM checkout.
 */
const RUN_VARIABLES = new Set([
  "WATCH_REPORT_DEPENDENCIES", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_UNIQUE_ID",
  "NODE_PATH", "NODE", "INIT_CWD", "PNPM_PACKAGE_NAME", "PNPM_SCRIPT_SRC_DIR",
]);
const RUN_PREFIXES = ["npm_", "pnpm_config_"];

const isRunVariable = (name: string) =>
  RUN_VARIABLES.has(name) || RUN_PREFIXES.some((p) => name.toLowerCase().startsWith(p));

/**
 * `node_modules/.bin` directories a package manager put in front of `PATH` for the daemon's own
 * script run. A relative entry stays: it resolves inside the agent's worktree.
 */
const isRunBinDir = (dir: string) => isAbsolute(dir) && dir.endsWith(`${sep}node_modules${sep}.bin`);

/**
 * The daemon's environment without tokens and without traces of how the daemon was started, with
 * a `PATH` that has no `gh`/`glab`/`jira`, and with `gh`/`glab` configured from an empty
 * directory: called by absolute path, or as git's credential helper, they find no login (#16).
 */
export async function agentEnv(base: NodeJS.ProcessEnv, dirs: { shimRoot: string; emptyConfigDir: string }): Promise<NodeJS.ProcessEnv> {
  const env = { ...base };
  for (const name of [...TOKEN_VARIABLES, ...HOST_VARIABLES]) delete env[name];
  for (const name of Object.keys(env)) if (isRunVariable(name)) delete env[name];
  const path = (base.PATH ?? "").split(delimiter).filter((dir) => !isRunBinDir(dir)).join(delimiter);
  env.PATH = await filteredPath(path, dirs.shimRoot);
  await mkdir(dirs.emptyConfigDir, { recursive: true, mode: 0o700 });
  for (const name of CONFIG_DIR_VARIABLES) env[name] = dirs.emptyConfigDir;
  return env;
}
