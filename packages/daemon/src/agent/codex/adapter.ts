import { AGENT_CAPABILITIES, codexPolicy } from "@donepm/core";
import type { AdapterLaunch, AgentAdapter } from "../adapter.js";
import { codexArgv } from "./argv.js";
import { CodexConnection } from "./connection.js";
import { writeTokenFile } from "./token-file.js";

/**
 * Codex CLI over `codex app-server` JSON-RPC (issue #137, Bloom CODEX.md). The thread is kept in the
 * one process, so a later user message goes in without a restart; a new process resumes the thread.
 */
export const codex: AgentAdapter = {
  kind: "codex",
  command: "codex",
  capabilities: AGENT_CAPABILITIES.codex,

  launch(input: AdapterLaunch) {
    const readOnly = input.playbook.readOnly === true;
    const base = { readOnly, profile: codexPolicy(input.playbook).extends, ...(input.home ? { home: input.home } : {}) };
    if (!input.mcp) return { args: codexArgv(base) };
    // The MCP config is on Codex's command line, visible in `ps`: the token goes in a 0600 file.
    const { DONEPM_TOKEN: token, ...env } = input.mcp.env;
    const file = token ? writeTokenFile(input.mcp.dir, input.itemId, token) : undefined;
    const mcp = { command: input.mcp.command, args: input.mcp.args, env: { ...env, ...(file ? { DONEPM_TOKEN_FILE: file.path } : {}) } };
    return { args: codexArgv({ ...base, mcp }), ...(file ? { cleanup: file.remove } : {}) };
  },

  connect(input: AdapterLaunch) {
    return new CodexConnection(input);
  },
};
