import type { Playbook } from "@donepm/core";

/** Commands that reach a forge or tracker with the user's credentials. Never in the agent's reach. */
export const BLOCKED_COMMANDS = ["gh", "glab", "jira"] as const;

/**
 * Deny rules passed via `--settings`, on top of the filtered `PATH` (spec 9.1). Both together:
 * the rules stop a command spelled out in Bash, the `PATH` stops it being found at all.
 */
export const DENY_RULES = [...BLOCKED_COMMANDS.map((c) => `Bash(${c} *)`), "Bash(git push*)"] as const;

export interface ArgvInput {
  playbook: Pick<Playbook, "model" | "effort" | "permissionMode">;
  /** Per-session MCP config file (mode 0600), never inline JSON: argv is visible in `ps`. */
  mcpConfigPath?: string;
  resumeSessionId?: string;
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
  args.push("--settings", JSON.stringify({ permissions: { deny: DENY_RULES } }));
  if (input.mcpConfigPath) args.push("--mcp-config", input.mcpConfigPath);
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  return args;
}

/** One NDJSON line carrying a user turn (spec 9.2). */
export function userTurnLine(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

export type AskBehavior = "allow" | "deny";

/** Answer to a `can_use_tool` question (spec 9.4). `request_id` must match the question. */
export function askAnswerLine(
  requestId: string,
  answer: { behavior: "allow"; input: unknown } | { behavior: "deny"; message: string },
): string {
  const response =
    answer.behavior === "allow"
      ? { behavior: "allow", updatedInput: answer.input }
      : { behavior: "deny", message: answer.message };
  return JSON.stringify({ type: "control_response", response: { request_id: requestId, subtype: "success", response } });
}
