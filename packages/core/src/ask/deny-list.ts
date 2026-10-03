/** Commands that reach a forge or tracker with the user's credentials. Never in the agent's reach. */
export const BLOCKED_COMMANDS = ["gh", "glab", "jira"] as const;

/**
 * Deny rules passed via `--settings`, on top of the filtered `PATH` (spec 9.1). Both together:
 * the rules stop a command spelled out in Bash, the `PATH` stops it being found at all.
 */
export const DENY_RULES = [...BLOCKED_COMMANDS.map((c) => `Bash(${c} *)`), "Bash(git push*)"] as const;
