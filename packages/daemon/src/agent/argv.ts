import { join } from "node:path";
import { BLOCKED_COMMANDS, DENY_RULES, isRuleOfferable, type PermissionRule, type Playbook } from "@donepm/core";

// One source for the deny list: core's `isRuleOfferable` checks grants against the same commands.
export { BLOCKED_COMMANDS, DENY_RULES };

/** donePM's own MCP server. Its tools only create drafts, so they need no question per call. */
export const ALLOW_RULES = ["mcp__donepm"] as const;

/**
 * Claude Code's Bash sandbox (D27). The deny rules and `PATH` only stop `gh` spelled the usual way;
 * `/opt/homebrew/bin/gh`, `env gh` or `git -c … push` slip past them (#16). Inside the sandbox
 * every connection to a host asks first (`SandboxNetworkAccess`), and that question reaches the user
 * like any other: nothing leaves the machine without them. There is no allowlist on purpose: a
 * package registry also takes `npm publish`. No way out of the sandbox for the model.
 */
export function sandboxSettings(home: string | undefined) {
  return {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    // Writes outside the worktree fail inside the sandbox; build tools keep their caches here.
    ...(home ? { filesystem: { allowWrite: CACHE_DIRS.map((d) => join(home, d)) } } : {}),
  };
}

const CACHE_DIRS = ["Library/Caches", ".cache", ".npm"] as const;

export interface ArgvInput {
  playbook: Pick<Playbook, "model" | "effort" | "permissionMode">;
  /** Per-session MCP config file (mode 0600), never inline JSON: argv is visible in `ps`. */
  mcpConfigPath?: string;
  resumeSessionId?: string;
  /** The agent's home, for the sandbox's writable cache directories. */
  home?: string;
}

/** Arguments for `claude` (spec 9.1, Bloom PROTOCOL.md "How Bloom invokes it"). */
export function claudeArgv(input: ArgvInput): string[] {
  const { playbook } = input;
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode", playbook.permissionMode,
    // Undocumented but required: without it the CLI answers its own permission questions with no.
    "--permission-prompt-tool", "stdio",
    "--model", playbook.model,
  ];
  if (playbook.effort) args.push("--effort", playbook.effort);
  // One object: --settings does not accumulate.
  args.push("--settings", JSON.stringify({ permissions: { allow: ALLOW_RULES, deny: DENY_RULES }, sandbox: sandboxSettings(input.home) }));
  if (input.mcpConfigPath) args.push("--mcp-config", input.mcpConfigPath);
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  return args;
}

/** One NDJSON line carrying a user turn (spec 9.2). */
export function userTurnLine(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

export type AskBehavior = "allow" | "deny";

/**
 * Answer to a `can_use_tool` question (spec 9.4). `request_id` must match the question.
 * `rules` on an allow grant those rules for the rest of the run: destination is always `session`,
 * so nothing is written to the user's settings files, and a rule the deny list forbids is refused.
 */
export function askAnswerLine(
  requestId: string,
  answer:
    | { behavior: "allow"; input: unknown; rules?: readonly PermissionRule[] }
    | { behavior: "deny"; message: string },
): string {
  let response: Record<string, unknown>;
  if (answer.behavior === "allow") {
    response = { behavior: "allow", updatedInput: answer.input };
    if (answer.rules?.length) {
      const blocked = answer.rules.find((r) => !isRuleOfferable(r));
      if (blocked) throw new Error(`refusing to grant ${blocked.toolName}(${blocked.ruleContent ?? ""})`);
      response.updatedPermissions = [{ type: "addRules", rules: answer.rules, behavior: "allow", destination: "session" }];
    }
  } else {
    response = { behavior: "deny", message: answer.message };
  }
  return JSON.stringify({ type: "control_response", response: { request_id: requestId, subtype: "success", response } });
}
