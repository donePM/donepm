/**
 * Commands that reach a forge or tracker with the user's credentials, and `security`, which reads
 * the Keychain where API tokens live (D8, D50). Never in the agent's reach.
 */
export const BLOCKED_COMMANDS = ["gh", "glab", "jira", "az", "acli", "security"] as const;

/**
 * Deny rules passed via `--settings`, on top of the filtered `PATH` (spec 9.1). Both together:
 * the rules stop a command spelled out in Bash, the `PATH` stops it being found at all.
 */
export const DENY_RULES = [...BLOCKED_COMMANDS.map((c) => `Bash(${c} *)`), "Bash(git push*)"] as const;

/**
 * A `read_only` playbook (D42) also loses every tool that writes files or reaches the web. Deny
 * beats any allow, a grant included.
 */
export const READ_ONLY_DENY_RULES = ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"] as const;

/**
 * What a `read_only` agent runs without a question: reading the history and the diff. Any other
 * Bash command asks the user, since the worktree holds code nobody vetted yet.
 */
export const READ_ONLY_ALLOW_RULES = ["Bash(git diff *)", "Bash(git log *)", "Bash(git show *)"] as const;
