/**
 * Commands that reach a forge or tracker with the user's credentials, and `security`, which reads
 * the Keychain where API tokens live (D8, D50). Never in the agent's reach.
 */
export const BLOCKED_COMMANDS = ["gh", "glab", "jira", "az", "acli", "security"] as const;

/**
 * Defence in depth only (issue #170): `security` spelled out by path or behind a launcher. These
 * rules are bypassable (a copy of the binary, a symlink, `osascript`, a script that calls the
 * Security framework) and are not what keeps the Keychain closed. The agent's sandbox is: it denies
 * reading `~/Library/Keychains` (the daemon's agent settings, D50).
 */
export const SPELLED_OUT_KEYCHAIN_DENY_RULES = [
  "Bash(/usr/bin/security *)",
  "Bash(env security *)",
  "Bash(env /usr/bin/security *)",
  "Bash(/usr/bin/env security *)",
  "Bash(/usr/bin/env /usr/bin/security *)",
  "Bash(command security *)",
  "Bash(exec security *)",
  "Bash(xcrun security *)",
] as const;

/**
 * Deny rules passed via `--settings`, on top of the filtered `PATH` (spec 9.1). Both together:
 * the rules stop a command spelled out in Bash, the `PATH` stops it being found at all.
 */
export const DENY_RULES = [
  ...BLOCKED_COMMANDS.map((c) => `Bash(${c} *)`),
  "Bash(git push*)",
  ...SPELLED_OUT_KEYCHAIN_DENY_RULES,
] as const;

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
