import type { CodexBaseProfile } from "@donepm/core";
import { keychainDirs } from "../claude/argv.js";

/** donePM's MCP server for Codex, under the same name as for Claude Code. */
export const MCP_SERVER_NAME = "donepm";

/** donePM's Codex permission profile. */
export const PERMISSION_PROFILE = "donepm";

/** A TOML basic string. JSON's escapes are TOML's, except DEL, which TOML wants escaped too. */
export function tomlString(s: string): string {
  return JSON.stringify(s).replace(/\u007f/g, "\\u007f");
}

/** A TOML inline table of strings, keys quoted. */
function tomlTable(entries: Record<string, string>): string {
  return `{${Object.entries(entries).map(([k, v]) => `${tomlString(k)}=${tomlString(v)}`).join(",")}}`;
}

export interface CodexArgvInput {
  /** The built-in profile the sandbox extends; `:read-only` when not given. */
  profile?: CodexBaseProfile;
  /** The agent's home, for the absolute Keychain path. */
  home?: string;
  readOnly?: boolean;
  /** donePM's MCP server. `env` holds the token file's path, never the token: argv is visible in `ps`. */
  mcp?: { command: string; args: string[]; env: Record<string, string> };
}

/**
 * The sandbox as a Codex permission profile (issue #137, D50). Only a profile can deny reading a
 * path; the legacy `sandbox_mode` policies cannot. It extends `:workspace` (writes in the thread's
 * `cwd`) or `:read-only`, keeps the network closed (a profile's default), and denies reading the
 * Keychain files, as Claude Code's sandbox does (#170): with the read denied, the Security framework
 * finds nothing for a sandboxed command. Verified with `codex sandbox macos` and app-server's
 * `command/exec` (Codex 0.133.0): a denied path fails "Operation not permitted", `~` is expanded, the
 * `cwd` stays writable. A `sandbox` on `thread/start` or a `sandboxPolicy` on `turn/start` replaces
 * the profile, so the connection sends neither.
 */
export function permissionProfileArgs(profile: CodexBaseProfile, home: string | undefined): string[] {
  const key = `permissions.${PERMISSION_PROFILE}`;
  const deny = Object.fromEntries(keychainDirs(home).map((dir) => [dir, "deny"]));
  return [
    "-c", `default_permissions=${tomlString(PERMISSION_PROFILE)}`,
    "-c", `${key}.extends=${tomlString(profile)}`,
    "-c", `${key}.filesystem=${tomlTable(deny)}`,
  ];
}

/**
 * Arguments for `codex app-server` (issue #137). The approval policy goes with each `thread/start`
 * and `turn/start`; here what has to be config: the sandbox as a permission profile, no network for
 * commands should a legacy policy ever apply, no web search for a `read_only` playbook (D42), and
 * donePM's MCP server, whose tools only create drafts and so run without a question (as
 * `mcp__donepm` is allowed for Claude Code).
 */
export function codexArgv(input: CodexArgvInput): string[] {
  const args = [
    "app-server", "--listen", "stdio://",
    ...permissionProfileArgs(input.profile ?? ":read-only", input.home),
    "-c", "sandbox_workspace_write.network_access=false",
  ];
  if (input.readOnly) args.push("-c", `web_search=${tomlString("disabled")}`);
  if (input.mcp) {
    const key = `mcp_servers.${MCP_SERVER_NAME}`;
    args.push(
      "-c", `${key}.command=${tomlString(input.mcp.command)}`,
      "-c", `${key}.args=[${input.mcp.args.map(tomlString).join(",")}]`,
      "-c", `${key}.env=${tomlTable(input.mcp.env)}`,
      "-c", `${key}.enabled=true`,
      "-c", `${key}.default_tools_approval_mode=${tomlString("approve")}`,
    );
  }
  return args;
}
