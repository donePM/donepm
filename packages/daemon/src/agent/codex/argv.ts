/** donePM's MCP server for Codex, under the same name as for Claude Code. */
export const MCP_SERVER_NAME = "donepm";

/** A TOML basic string. JSON's escapes are TOML's, except DEL, which TOML wants escaped too. */
export function tomlString(s: string): string {
  return JSON.stringify(s).replace(/\u007f/g, "\\u007f");
}

/** A TOML inline table of strings, keys quoted. */
function tomlTable(entries: Record<string, string>): string {
  return `{${Object.entries(entries).map(([k, v]) => `${tomlString(k)}=${tomlString(v)}`).join(",")}}`;
}

export interface CodexArgvInput {
  readOnly?: boolean;
  /** donePM's MCP server. `env` holds the token file's path, never the token: argv is visible in `ps`. */
  mcp?: { command: string; args: string[]; env: Record<string, string> };
}

/**
 * Arguments for `codex app-server` (issue #137). The sandbox and approval policy go with each
 * `thread/start` and `turn/start`; here only what has to be config: no network for commands even in
 * `workspace-write`, no web search for a `read_only` playbook (D42), and donePM's MCP server, whose
 * tools only create drafts and so run without a question (as `mcp__donepm` is allowed for Claude Code).
 */
export function codexArgv(input: CodexArgvInput): string[] {
  const args = ["app-server", "--listen", "stdio://", "-c", "sandbox_workspace_write.network_access=false"];
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
